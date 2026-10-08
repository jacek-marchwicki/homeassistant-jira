"""Production Jira Cloud & Data Center REST API Client Adapter.

Implements JiraClientProtocol using HTTPX async client, handling authentication,
issue queries, workflow transition discovery and execution, error translation,
and webhook parsing.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from jira_dashboard.adapters.jira_client import (
    STATUS_MAP,
    JiraAPIError,
    JiraClientProtocol,
)
from jira_dashboard.config import JiraDashboardSettings
from jira_dashboard.domain import (
    BoardColumn,
    IssueType,
    JiraComment,
    JiraIssue,
    JiraStatus,
    JiraUser,
    Priority,
    StatusCategory,
)

logger = logging.getLogger(__name__)

DEFAULT_JIRA_CLOUD_COLUMNS: list[BoardColumn] = [
    BoardColumn(id="col-todo", name="To Do", category=StatusCategory.TODO, status_ids=["1"]),
    BoardColumn(
        id="col-inprogress",
        name="In Progress",
        category=StatusCategory.IN_PROGRESS,
        status_ids=["2"],
    ),
    BoardColumn(id="col-done", name="Done", category=StatusCategory.DONE, status_ids=["3"]),
]


def map_category_key(cat_key: str, status_name: str = "") -> StatusCategory:
    """Map Jira statusCategory key and status name to domain StatusCategory."""
    lowered_cat = (cat_key or "").strip().lower()
    lowered_name = (status_name or "").strip().lower()

    if "block" in lowered_name:
        return StatusCategory.BLOCKED
    if "review" in lowered_name:
        return StatusCategory.IN_REVIEW

    category_mapping: dict[str, StatusCategory] = {
        "new": StatusCategory.TODO,
        "todo": StatusCategory.TODO,
        "to do": StatusCategory.TODO,
        "indeterminate": StatusCategory.IN_PROGRESS,
        "inprogress": StatusCategory.IN_PROGRESS,
        "in_progress": StatusCategory.IN_PROGRESS,
        "in review": StatusCategory.IN_REVIEW,
        "done": StatusCategory.DONE,
        "complete": StatusCategory.DONE,
        "blocked": StatusCategory.BLOCKED,
    }
    return category_mapping.get(lowered_cat, StatusCategory.TODO)


def map_issue_type(name: str) -> IssueType:
    """Map Jira issue type string to domain IssueType."""
    lowered = (name or "").strip().lower()
    if "bug" in lowered:
        return IssueType.BUG
    if "story" in lowered:
        return IssueType.STORY
    if "epic" in lowered:
        return IssueType.EPIC
    if "subtask" in lowered or "sub-task" in lowered:
        return IssueType.SUBTASK
    return IssueType.TASK


def map_priority(name: str) -> Priority:
    """Map Jira priority string to domain Priority."""
    lowered = (name or "").strip().lower()
    if "highest" in lowered or "blocker" in lowered or "critical" in lowered:
        return Priority.HIGHEST
    if "high" in lowered or "major" in lowered:
        return Priority.HIGH
    if "lowest" in lowered or "trivial" in lowered:
        return Priority.LOWEST
    if "low" in lowered or "minor" in lowered:
        return Priority.LOW
    return Priority.MEDIUM


JIRA_ISSUE_FIELDS: list[str] = [
    "summary",
    "description",
    "issuetype",
    "priority",
    "status",
    "assignee",
    "created",
    "updated",
    "duedate",
    "startDate",
    "customfield_10015",  # Start date
    "customfield_10027",  # Recreate after
    "customfield_10016",  # Story points
    "customfield_10026",
    "customfield_10004",
    "customfield_10028",
    "customfield_10019",  # Jira LexoRank
    "rank",
    "customfield_10009",
]


class JiraCloudClient(JiraClientProtocol):
    """Client for interacting with Jira Cloud / Data Center REST APIs."""

    def __init__(
        self,
        settings: JiraDashboardSettings,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings
        self._custom_client = http_client is not None
        raw_url = (settings.jira_url or "https://jira.example.com").strip()
        clean_url = raw_url.rstrip("/")
        if clean_url.endswith("/browse"):
            clean_url = clean_url[:-7].rstrip("/")
        self.jira_browse_url = clean_url or "https://jira.example.com"
        self.base_url = self.jira_browse_url

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "HomeAssistant-JiraDashboard/0.1.1",
        }
        auth: httpx.Auth | None = None

        if settings.jira_email and settings.jira_api_token:
            auth = httpx.BasicAuth(settings.jira_email, settings.jira_api_token)

        self._client = (
            http_client
            if http_client is not None
            else httpx.AsyncClient(
                base_url=self.base_url,
                headers=headers,
                auth=auth,
                timeout=15.0,
            )
        )

    async def close(self) -> None:
        """Close underlying HTTP client connection pool."""
        await self._client.aclose()

    async def _discover_cloud_id(self, site_url: str) -> str | None:
        """Discover the Atlassian Cloud ID for a given Jira Cloud site URL."""
        try:
            clean_url = site_url.rstrip("/")
            async with httpx.AsyncClient(timeout=5.0) as probe_client:
                r = await probe_client.get(f"{clean_url}/_edge/tenant_info")
                if r.is_success:
                    return r.json().get("cloudId")
        except Exception as exc:
            logger.debug("Failed to discover Atlassian cloudId from %s: %s", site_url, exc)
        return None

    @staticmethod
    def _format_request_error(exc: Exception) -> str:
        """Format an httpx exception into a descriptive error string."""
        err_msg = str(exc).strip()
        if err_msg:
            return f"{type(exc).__name__}: {err_msg}"
        return type(exc).__name__

    def _get_gateway_lock(self) -> asyncio.Lock:
        """Lazily initialize asyncio.Lock bound to active event loop."""
        if getattr(self, "_gateway_lock", None) is None:
            self._gateway_lock = asyncio.Lock()
        return self._gateway_lock

    async def _send_request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Execute an HTTP request, automatically resolving Atlassian Cloud Gateway if needed."""
        # 1. Proactively resolve Atlassian Cloud Gateway if scoped token (ATATT...)
        # is used with a direct *.atlassian.net URL
        if (
            not self._custom_client
            and not getattr(self, "_gateway_resolved", False)
            and ".atlassian.net" in str(self._client.base_url)
            and "api.atlassian.com" not in str(self._client.base_url)
            and bool(
                self.settings.jira_api_token and self.settings.jira_api_token.startswith("ATATT")
            )
        ):
            async with self._get_gateway_lock():
                if not getattr(self, "_gateway_resolved", False):
                    cloud_id = await self._discover_cloud_id(str(self._client.base_url))
                    if cloud_id:
                        gateway_url = f"https://api.atlassian.com/ex/jira/{cloud_id}"
                        logger.info(
                            "Detected Atlassian scoped token; resolved Cloud ID %s; base URL: %s",
                            cloud_id,
                            gateway_url,
                        )
                        self.base_url = gateway_url
                        headers = dict(self._client.headers)
                        auth = self._client.auth
                        old_client = self._client
                        self._client = httpx.AsyncClient(
                            base_url=gateway_url,
                            headers=headers,
                            auth=auth,
                            timeout=15.0,
                        )
                        asyncio.create_task(old_client.aclose())
                    self._gateway_resolved = True

        res = await self._client.request(method, url, **kwargs)

        # 2. Reactive resolution if direct atlassian.net returns 401
        if (
            not self._custom_client
            and res.status_code == 401
            and ".atlassian.net" in str(self._client.base_url)
            and "api.atlassian.com" not in str(self._client.base_url)
        ):
            async with self._get_gateway_lock():
                if ".atlassian.net" in str(self._client.base_url):
                    cloud_id = await self._discover_cloud_id(str(self._client.base_url))
                    if cloud_id:
                        gateway_url = f"https://api.atlassian.com/ex/jira/{cloud_id}"
                        logger.info(
                            "Resolved Atlassian Cloud ID %s on 401; switching to gateway %s",
                            cloud_id,
                            gateway_url,
                        )
                        self.base_url = gateway_url
                        headers = dict(self._client.headers)
                        auth = self._client.auth
                        old_client = self._client
                        self._client = httpx.AsyncClient(
                            base_url=gateway_url,
                            headers=headers,
                            auth=auth,
                            timeout=15.0,
                        )
                        asyncio.create_task(old_client.aclose())
                        res = await self._client.request(method, url, **kwargs)
        return res

    def _handle_response_errors(self, response: httpx.Response) -> None:
        """Check response status and raise typed JiraAPIError if error occurred."""
        if response.is_success:
            return

        status = response.status_code
        try:
            body = response.json()
            error_messages = body.get("errorMessages", [])
            errors = body.get("errors", {})
            gateway_msg = body.get("message")
            if error_messages:
                msg = "; ".join(error_messages)
            elif gateway_msg:
                msg = str(gateway_msg)
            else:
                msg = str(errors or response.text)
        except Exception:
            msg = response.text or f"HTTP {status} from Jira"

        if status == 401:
            raise JiraAPIError(f"Jira Unauthorized (401): {msg}", status_code=401)
        if status == 403:
            raise JiraAPIError(f"Jira Forbidden (403): {msg}", status_code=403)
        if status == 404:
            raise JiraAPIError(f"Jira Not Found (404): {msg}", status_code=404)
        if status == 429:
            retry_after = response.headers.get("Retry-After", "30")
            raise JiraAPIError(
                f"Jira Rate Limited (429): retry after {retry_after}s. {msg}",
                status_code=429,
            )
        raise JiraAPIError(f"Jira API error ({status}): {msg}", status_code=status)

    def _parse_issue(self, data: dict[str, Any]) -> JiraIssue:
        """Parse Jira issue JSON structure into domain JiraIssue."""
        issue_id = str(data.get("id", ""))
        key = str(data.get("key", ""))
        fields = data.get("fields", {})

        summary = fields.get("summary", "")
        updated_at = fields.get("updated", "")

        # Issue Type
        type_data = fields.get("issuetype", {})
        issue_type = map_issue_type(type_data.get("name", "Task"))

        # Priority
        priority_data = fields.get("priority", {})
        priority = map_priority(priority_data.get("name", "Medium"))

        # Status
        status_data = fields.get("status", {})
        status_id = str(status_data.get("id", "0"))
        status_name = status_data.get("name", "To Do")
        cat_info = status_data.get("statusCategory", {})
        category = map_category_key(cat_info.get("key", "new"), status_name)
        status = JiraStatus(
            id=status_id,
            name=status_name,
            category=category,
            color=cat_info.get("colorName"),
        )

        # Assignee
        assignee: JiraUser | None = None
        assignee_data = fields.get("assignee")
        if assignee_data and isinstance(assignee_data, dict):
            account_id = assignee_data.get("accountId") or assignee_data.get("name", "")
            display_name = assignee_data.get("displayName", "Unknown")
            avatar_urls = assignee_data.get("avatarUrls", {})
            avatar_url = (
                avatar_urls.get("48x48")
                or avatar_urls.get("32x32")
                or avatar_urls.get("24x24")
                or avatar_urls.get("16x16")
            )
            assignee = JiraUser(
                account_id=account_id,
                display_name=display_name,
                avatar_url=avatar_url,
            )

        # Story points (heuristic over common Jira custom fields)
        story_points: float | None = None
        for sp_key in (
            "story_points",
            "customfield_10016",
            "customfield_10026",
            "customfield_10004",
            "customfield_10028",
        ):
            if sp_key in fields and fields[sp_key] is not None:
                try:
                    story_points = float(fields[sp_key])
                    break
                except (ValueError, TypeError):
                    pass

        # Due date
        raw_due_date = fields.get("duedate") or fields.get("due_date")
        due_date = str(raw_due_date) if raw_due_date is not None else None

        # Start date (Jira Cloud standard customfield_10015 or standard aliases)
        raw_start_date = (
            fields.get("customfield_10015") or fields.get("startDate") or fields.get("start_date")
        )
        start_date = str(raw_start_date) if raw_start_date is not None else None

        # Recreate after (customfield_10027 or standard aliases)
        raw_recreate_after = (
            fields.get("customfield_10027")
            or fields.get("recreate_after")
            or fields.get("recreateAfter")
        )
        recreate_after = str(raw_recreate_after) if raw_recreate_after is not None else None

        # Rank (customfield_10019, rank, or customfield_10009)
        raw_rank = (
            fields.get("customfield_10019") or fields.get("rank") or fields.get("customfield_10009")
        )
        rank = str(raw_rank) if raw_rank is not None else None

        # Description
        raw_description = fields.get("description")
        description: str | None = None
        if isinstance(raw_description, str):
            description = raw_description
        elif isinstance(raw_description, dict):
            try:

                def _extract_adf_text(node: Any) -> list[str]:
                    texts = []
                    if isinstance(node, dict):
                        if node.get("type") == "text" and "text" in node:
                            texts.append(str(node["text"]))
                        for v in node.values():
                            texts.extend(_extract_adf_text(v))
                    elif isinstance(node, list):
                        for item in node:
                            texts.extend(_extract_adf_text(item))
                    return texts

                extracted = " ".join(_extract_adf_text(raw_description)).strip()
                description = extracted if extracted else None
            except Exception:
                description = None

        created_at = fields.get("created") or fields.get("created_at")
        url = self._determine_browse_url(data, key)

        return JiraIssue(
            id=issue_id,
            key=key,
            summary=summary,
            description=description,
            url=url,
            issue_type=issue_type,
            priority=priority,
            status=status,
            assignee=assignee,
            story_points=story_points,
            due_date=due_date,
            start_date=start_date,
            recreate_after=recreate_after,
            rank=rank,
            created_at=created_at,
            updated_at=updated_at,
        )

    def _determine_browse_url(self, issue_data: dict[str, Any], key: str) -> str:
        """Determine human-browsable Jira web URL for an issue.

        Guarantees format: https://<domain>/browse/<KEY> (e.g. https://marchwicki.atlassian.net/browse/HOME-15103).
        Avoids Atlassian API Gateway base URLs (api.atlassian.com) which cannot be browsed directly.
        """
        # 1. Configured jira_browse_url if not gateway and not example
        if (
            self.jira_browse_url
            and "api.atlassian.com" not in self.jira_browse_url
            and self.jira_browse_url != "https://jira.example.com"
        ):
            return f"{self.jira_browse_url}/browse/{key}"

        # 2. Extract domain from issue 'self' link if it contains direct site domain
        self_url = str(issue_data.get("self") or "")
        if self_url.startswith("http") and "api.atlassian.com" not in self_url:
            parts = self_url.split("/rest/")
            if len(parts) > 1:
                site_base = parts[0].rstrip("/")
                return f"{site_base}/browse/{key}"

        # 3. Fallback
        base = self.jira_browse_url or "https://jira.example.com"
        if "api.atlassian.com" in base and self.settings.jira_url:
            base = self.settings.jira_url.rstrip("/")
        if base.endswith("/browse"):
            base = base[:-7].rstrip("/")
        return f"{base}/browse/{key}"

    async def get_board_issues(self, board_id: str) -> list[JiraIssue]:
        """Fetch active issues for a given board ID or project key across all pages."""
        fields_str = ",".join(JIRA_ISSUE_FIELDS)
        try:
            # 1. First attempt Jira Agile API
            agile_params: dict[str, Any] = {
                "maxResults": 100,
                "startAt": 0,
                "fields": fields_str,
            }
            res = await self._send_request(
                "GET",
                f"/rest/agile/1.0/board/{board_id}/issue",
                params=agile_params,
            )
            # If board is 404, or 400 (e.g. project key used instead of board ID),
            # or 401 with "scope does not match" (user token missing read:jira-agile scope),
            # fallback to standard modern JQL search endpoint /rest/api/3/search/jql
            should_fallback_to_jql = res.status_code in (400, 404) or (
                res.status_code == 401 and "scope does not match" in res.text.lower()
            )

            if not should_fallback_to_jql:
                self._handle_response_errors(res)
                data = res.json()
                issues_raw = list(data.get("issues", []))
                total = data.get("total", len(issues_raw))
                is_last = data.get("isLast", len(issues_raw) >= total)

                # Page through remaining active issues (up to 2,000 issues)
                max_pages = 20
                page_count = 1
                while not is_last and len(issues_raw) < total and page_count < max_pages:
                    next_params: dict[str, Any] = {
                        "maxResults": 100,
                        "startAt": len(issues_raw),
                        "fields": fields_str,
                    }
                    next_res = await self._send_request(
                        "GET",
                        f"/rest/agile/1.0/board/{board_id}/issue",
                        params=next_params,
                    )
                    self._handle_response_errors(next_res)
                    page_data = next_res.json()
                    page_issues = page_data.get("issues", [])
                    if not page_issues:
                        break
                    issues_raw.extend(page_issues)
                    page_count += 1
                    is_last = page_data.get("isLast", len(issues_raw) >= total)
                    if len(page_issues) < 100:
                        break

                return [self._parse_issue(issue) for issue in issues_raw]

            # 2. Modern JQL search endpoint fallback (/rest/api/3/search/jql or /rest/api/3/search)
            # Query active issues (non-Done issues or issues updated within the last 14 days)
            # to avoid transferring thousands of historical closed tickets.
            jql = (
                f"project = '{board_id}' AND "
                "(statusCategory != Done OR updated >= -14d) ORDER BY updated DESC"
            )

            search_endpoint = "/rest/api/3/search/jql"
            search_params: dict[str, Any] = {
                "jql": jql,
                "fields": fields_str,
                "maxResults": 100,
                "startAt": 0,
            }
            res = await self._send_request("GET", search_endpoint, params=search_params)
            # If 404 on /rest/api/3/search/jql, fallback to classic /rest/api/3/search
            if res.status_code == 404:
                search_endpoint = "/rest/api/3/search"
                res = await self._send_request("GET", search_endpoint, params=search_params)

            self._handle_response_errors(res)
            data = res.json()
            issues_raw = list(data.get("issues", []))
            total = data.get("total", len(issues_raw))
            next_page_token = data.get("nextPageToken")
            is_last = data.get("isLast", False) or (
                len(issues_raw) >= total and not next_page_token
            )

            max_pages = 20
            page_count = 1
            while (
                not is_last
                and (len(issues_raw) < total or next_page_token)
                and page_count < max_pages
            ):
                page_params: dict[str, Any] = {
                    "jql": jql,
                    "fields": fields_str,
                    "maxResults": 100,
                    "startAt": len(issues_raw),
                }
                if next_page_token:
                    page_params["nextPageToken"] = next_page_token

                next_res = await self._send_request("GET", search_endpoint, params=page_params)
                self._handle_response_errors(next_res)
                page_data = next_res.json()
                page_issues = page_data.get("issues", [])
                if not page_issues:
                    break
                issues_raw.extend(page_issues)
                page_count += 1
                next_page_token = page_data.get("nextPageToken")
                is_last = page_data.get("isLast", False) or (
                    len(issues_raw) >= total and not next_page_token
                )
                if len(page_issues) < 100 and not next_page_token:
                    break

            return [self._parse_issue(issue) for issue in issues_raw]
        except httpx.RequestError as exc:
            raise JiraAPIError(
                f"Failed to connect to Jira: {self._format_request_error(exc)}", status_code=503
            ) from exc

    async def get_board_columns(
        self, board_id: str, issues: list[JiraIssue] | None = None
    ) -> list[BoardColumn]:
        """Fetch workflow columns for a given project or board from Jira."""
        category_order = {
            StatusCategory.TODO: 0,
            StatusCategory.IN_PROGRESS: 1,
            StatusCategory.IN_REVIEW: 2,
            StatusCategory.DONE: 3,
            StatusCategory.BLOCKED: 4,
        }
        try:
            # 1. Query project statuses
            res = await self._send_request("GET", f"/rest/api/3/project/{board_id}/statuses")
            if res.is_success and isinstance(res.json(), list):
                seen_ids: set[str] = set()
                discovered: list[BoardColumn] = []
                for issue_type in res.json():
                    for s in issue_type.get("statuses", []):
                        sid = str(s.get("id"))
                        sname = s.get("name", "").strip()
                        if sid not in seen_ids and sname:
                            seen_ids.add(sid)
                            cat_info = s.get("statusCategory", {})
                            cat_key = cat_info.get("key", "")
                            cat = map_category_key(cat_key, sname)
                            discovered.append(
                                BoardColumn(
                                    id=f"col-{sid}",
                                    name=sname,
                                    category=cat,
                                    status_ids=[sid],
                                )
                            )

                if discovered:
                    discovered.sort(key=lambda col: category_order.get(col.category, 99))
                    return discovered

            # 2. Fallback: extract distinct statuses from issues on board
            if issues is None:
                issues = await self.get_board_issues(board_id)
            if issues:
                seen_status_names: set[str] = set()
                issue_cols: list[BoardColumn] = []
                for issue in issues:
                    s_name = issue.status.name
                    if s_name not in seen_status_names:
                        seen_status_names.add(s_name)
                        col_id = f"col-{issue.status.id or s_name.lower().replace(' ', '-')}"
                        issue_cols.append(
                            BoardColumn(
                                id=col_id,
                                name=s_name,
                                category=issue.status.category,
                                status_ids=[issue.status.id] if issue.status.id else [],
                            )
                        )
                if issue_cols:
                    issue_cols.sort(key=lambda col: category_order.get(col.category, 99))
                    return issue_cols

            return list(DEFAULT_JIRA_CLOUD_COLUMNS)
        except Exception as exc:
            logger.debug("Failed to fetch project statuses for %s: %s", board_id, exc)
            return list(DEFAULT_JIRA_CLOUD_COLUMNS)

    async def get_issue(self, issue_key: str) -> JiraIssue | None:
        """Fetch a single issue by key."""
        try:
            res = await self._send_request("GET", f"/rest/api/3/issue/{issue_key}")
            if res.status_code == 404:
                return None
            self._handle_response_errors(res)
            return self._parse_issue(res.json())
        except httpx.RequestError as exc:
            raise JiraAPIError(
                f"Failed to connect to Jira: {self._format_request_error(exc)}", status_code=503
            ) from exc

    async def transition_issue(
        self,
        issue_key: str,
        target_category: StatusCategory | None = None,
        target_status: str | None = None,
    ) -> JiraIssue:
        """Transition an issue to a new status category or status name/ID."""
        try:
            trans_res = await self._send_request(
                "GET", f"/rest/api/3/issue/{issue_key}/transitions"
            )
            self._handle_response_errors(trans_res)
            trans_data = trans_res.json()
            available = trans_data.get("transitions", [])

            target_trans_id: str | None = None

            # 1. Match by specific target status name or ID
            if target_status:
                cleaned_target = target_status.strip().lower()
                for t in available:
                    to_status = t.get("to", {})
                    to_id = str(to_status.get("id", ""))
                    to_name = to_status.get("name", "").strip().lower()
                    t_name = t.get("name", "").strip().lower()
                    if (
                        to_id == target_status
                        or to_name == cleaned_target
                        or t_name == cleaned_target
                    ):
                        target_trans_id = str(t.get("id"))
                        break

            # 2. Match by category if no status match found
            if not target_trans_id and target_category:
                for t in available:
                    to_status = t.get("to", {})
                    to_name = to_status.get("name", "")
                    cat_info = to_status.get("statusCategory", {})
                    cat_key = cat_info.get("key", "")
                    cat = map_category_key(cat_key, to_name)
                    if cat == target_category:
                        target_trans_id = str(t.get("id"))
                        break

            if not target_trans_id:
                available_names = [
                    f"{t.get('name')} -> {t.get('to', {}).get('name')}" for t in available
                ]
                dest_desc = target_status or (target_category.value if target_category else "")
                raise JiraAPIError(
                    f"No transition available to move {issue_key} to '{dest_desc}'. "
                    f"Available transitions: {available_names}",
                    status_code=400,
                )

            # 3. Post transition execution
            exec_res = await self._send_request(
                "POST",
                f"/rest/api/3/issue/{issue_key}/transitions",
                json={"transition": {"id": target_trans_id}},
            )
            self._handle_response_errors(exec_res)

            # 4. Fetch and return refreshed issue
            updated = await self.get_issue(issue_key)
            if updated is None:
                # Fallback if get_issue fails after transition
                fallback_cat = target_category or StatusCategory.DONE
                return JiraIssue(
                    id=issue_key,
                    key=issue_key,
                    summary="Updated Issue",
                    issue_type=IssueType.TASK,
                    priority=Priority.MEDIUM,
                    status=STATUS_MAP.get(fallback_cat, STATUS_MAP[StatusCategory.DONE]),
                    updated_at="2026-10-05T00:00:00Z",
                )
            return updated
        except httpx.RequestError as exc:
            raise JiraAPIError(
                f"Failed to connect to Jira: {self._format_request_error(exc)}", status_code=503
            ) from exc

    async def rank_issue(
        self,
        issue_key: str,
        rank_before_key: str | None = None,
        rank_after_key: str | None = None,
        target_rank: str | None = None,
    ) -> JiraIssue:
        """Rank an issue using Jira Agile REST API PUT /rest/agile/1.0/issue/rank."""
        rank_payload: dict[str, Any] = {
            "issues": [issue_key],
        }
        if rank_before_key:
            rank_payload["rankBeforeIssue"] = rank_before_key
        elif rank_after_key:
            rank_payload["rankAfterIssue"] = rank_after_key

        try:
            res = await self._send_request(
                "PUT",
                "/rest/agile/1.0/issue/rank",
                json=rank_payload,
            )
            # If 401 with "scope does not match" on gateway (api.atlassian.com),
            # attempt direct site URL fallback if available (Basic Auth API tokens)
            if (
                res.status_code == 401
                and "scope does not match" in res.text.lower()
                and self.jira_browse_url
                and "api.atlassian.com" not in self.jira_browse_url
            ):
                direct_url = f"{self.jira_browse_url.rstrip('/')}/rest/agile/1.0/issue/rank"
                logger.info(
                    "Gateway returned 401 scope mismatch for %s; retrying directly on %s",
                    issue_key,
                    direct_url,
                )
                try:
                    direct_res = await self._client.request(
                        "PUT",
                        direct_url,
                        json=rank_payload,
                    )
                    if direct_res.is_success or direct_res.status_code != 401:
                        res = direct_res
                except Exception as direct_exc:
                    logger.debug("Direct rank fallback to %s failed: %s", direct_url, direct_exc)

            self._handle_response_errors(res)
        except Exception as exc:
            logger.warning("Failed to call Jira Agile rank API for issue %s: %s", issue_key, exc)
            raise

        updated = await self.get_issue(issue_key)
        if updated is None:
            raise JiraAPIError(f"Issue {issue_key} not found after ranking", status_code=404)
        if target_rank and not updated.rank:
            updated = updated.model_copy(update={"rank": target_rank})
        return updated

    async def update_issue(
        self,
        issue_key: str,
        summary: str | None = None,
        description: str | None = None,
        issue_type: IssueType | None = None,
        priority: Priority | None = None,
        status_category: StatusCategory | None = None,
        status_name: str | None = None,
        assignee_name: str | None = None,
        assignee_account_id: str | None = None,
        story_points: float | None = None,
        due_date: str | None = None,
        start_date: str | None = None,
        recreate_after: str | None = None,
    ) -> JiraIssue:
        """Update issue fields via Jira Cloud REST API."""
        fields: dict[str, Any] = {}
        if summary is not None:
            fields["summary"] = summary
        if description is not None:
            fields["description"] = (
                {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": description}],
                        }
                    ],
                }
                if description
                else None
            )
        if priority is not None:
            fields["priority"] = {"name": priority.value.capitalize()}
        if issue_type is not None:
            fields["issuetype"] = {"name": issue_type.value.capitalize()}
        if due_date is not None:
            fields["duedate"] = due_date if due_date else None
        if assignee_account_id is not None:
            fields["assignee"] = {"accountId": assignee_account_id} if assignee_account_id else None
        if recreate_after is not None:
            fields["customfield_10027"] = recreate_after if recreate_after else None

        if fields:
            try:
                res = await self._send_request(
                    "PUT", f"/rest/api/3/issue/{issue_key}", json={"fields": fields}
                )
                self._handle_response_errors(res)
            except httpx.RequestError as exc:
                raise JiraAPIError(
                    f"Failed to connect to Jira: {self._format_request_error(exc)}", status_code=503
                ) from exc

        if status_name or status_category:
            await self.transition_issue(
                issue_key, target_category=status_category, target_status=status_name
            )

        updated = await self.get_issue(issue_key)
        if not updated:
            raise JiraAPIError(f"Issue {issue_key} not found after update", status_code=404)
        return updated

    async def create_issue(
        self,
        summary: str,
        description: str | None = None,
        issue_type: IssueType = IssueType.TASK,
        priority: Priority = Priority.MEDIUM,
        status_category: StatusCategory = StatusCategory.TODO,
        status_name: str | None = None,
        assignee_name: str | None = None,
        assignee_account_id: str | None = None,
        story_points: float | None = None,
        due_date: str | None = None,
        start_date: str | None = None,
        recreate_after: str | None = None,
        board_id: str | None = None,
        project_key: str | None = None,
    ) -> JiraIssue:
        """Create a new issue via Jira Cloud REST API."""
        proj = project_key
        if not proj and board_id and not board_id.isdigit():
            proj = board_id.split("-")[0].upper()
        if not proj and self.settings.jira_board_id and not self.settings.jira_board_id.isdigit():
            proj = self.settings.jira_board_id.split("-")[0].upper()
        if not proj:
            proj = "PROJ"

        fields: dict[str, Any] = {
            "summary": summary,
            "project": {"key": proj},
            "issuetype": {"name": issue_type.value.capitalize()},
            "priority": {"name": priority.value.capitalize()},
        }
        if description:
            fields["description"] = {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": description}],
                    }
                ],
            }
        if due_date:
            fields["duedate"] = due_date
        if assignee_account_id:
            fields["assignee"] = {"accountId": assignee_account_id}
        if recreate_after:
            fields["customfield_10027"] = recreate_after

        try:
            res = await self._send_request("POST", "/rest/api/3/issue", json={"fields": fields})
            self._handle_response_errors(res)
            created_data = res.json()
            issue_key = created_data.get("key")
            if not issue_key:
                raise JiraAPIError("Jira response missing issue key", status_code=500)
        except httpx.RequestError as exc:
            raise JiraAPIError(
                f"Failed to connect to Jira: {self._format_request_error(exc)}", status_code=503
            ) from exc

        if status_name or (status_category and status_category != StatusCategory.TODO):
            try:
                await self.transition_issue(
                    issue_key, target_category=status_category, target_status=status_name
                )
            except Exception as exc:
                logger.warning("Issue %s created but transition failed: %s", issue_key, exc)

        created_issue = await self.get_issue(issue_key)
        if not created_issue:
            raise JiraAPIError(f"Issue {issue_key} not found after creation", status_code=404)
        return created_issue

    async def process_webhook(self, payload: dict[str, Any]) -> JiraIssue | None:
        """Parse incoming Jira Cloud webhook payload."""
        webhook_event = payload.get("webhookEvent")
        if webhook_event not in {"jira:issue_updated", "jira:issue_created", None}:
            return None

        issue_data = payload.get("issue")
        if not issue_data or not isinstance(issue_data, dict):
            return None

        return self._parse_issue(issue_data)

    def _parse_comment(self, data: dict[str, Any]) -> JiraComment:
        """Parse Jira comment JSON into domain JiraComment."""
        cid = str(data.get("id", ""))
        raw_body = data.get("body")
        body_text = ""
        if isinstance(raw_body, str):
            body_text = raw_body
        elif isinstance(raw_body, dict):

            def _extract_adf(node: Any) -> list[str]:
                texts = []
                if isinstance(node, dict):
                    if node.get("type") == "text" and "text" in node:
                        texts.append(str(node["text"]))
                    for v in node.values():
                        texts.extend(_extract_adf(v))
                elif isinstance(node, list):
                    for item in node:
                        texts.extend(_extract_adf(item))
                return texts

            body_text = "\n".join(_extract_adf(raw_body)).strip()

        author: JiraUser | None = None
        author_data = data.get("author")
        if author_data and isinstance(author_data, dict):
            account_id = author_data.get("accountId") or author_data.get("name", "")
            display_name = author_data.get("displayName", "Unknown")
            avatar_urls = author_data.get("avatarUrls", {})
            avatar_url = (
                avatar_urls.get("48x48")
                or avatar_urls.get("32x32")
                or avatar_urls.get("24x24")
                or avatar_urls.get("16x16")
            )
            author = JiraUser(
                account_id=account_id,
                display_name=display_name,
                avatar_url=avatar_url,
            )

        return JiraComment(
            id=cid,
            author=author,
            body=body_text,
            created=data.get("created", ""),
            updated=data.get("updated"),
        )

    async def get_comments(self, issue_key: str) -> list[JiraComment]:
        """Fetch comments for a given issue across all pages."""
        try:
            params: dict[str, Any] = {"maxResults": 100, "startAt": 0}
            res = await self._send_request(
                "GET", f"/rest/api/3/issue/{issue_key}/comment", params=params
            )
            self._handle_response_errors(res)
            data = res.json()
            comments_raw = list(data.get("comments", []))
            total = data.get("total", len(comments_raw))
            max_pages = 20
            page_count = 1
            while len(comments_raw) < total and page_count < max_pages:
                page_params = {"maxResults": 100, "startAt": len(comments_raw)}
                next_res = await self._send_request(
                    "GET", f"/rest/api/3/issue/{issue_key}/comment", params=page_params
                )
                self._handle_response_errors(next_res)
                page_data = next_res.json()
                page_comments = page_data.get("comments", [])
                if not page_comments:
                    break
                comments_raw.extend(page_comments)
                page_count += 1
                if len(page_comments) < 100:
                    break
            return [self._parse_comment(c) for c in comments_raw]
        except httpx.RequestError as exc:
            raise JiraAPIError(
                f"Failed to connect to Jira: {self._format_request_error(exc)}", status_code=503
            ) from exc

    async def add_comment(
        self, issue_key: str, body: str, author_name: str | None = None
    ) -> JiraComment:
        """Add a comment to an issue via Jira Cloud REST API."""
        payload = {
            "body": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": body}],
                    }
                ],
            }
        }
        try:
            res = await self._send_request(
                "POST", f"/rest/api/3/issue/{issue_key}/comment", json=payload
            )
            self._handle_response_errors(res)
            return self._parse_comment(res.json())
        except httpx.RequestError as exc:
            raise JiraAPIError(
                f"Failed to connect to Jira: {self._format_request_error(exc)}", status_code=503
            ) from exc

    async def update_comment(self, issue_key: str, comment_id: str, body: str) -> JiraComment:
        """Update an existing comment via Jira Cloud REST API."""
        payload = {
            "body": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": body}],
                    }
                ],
            }
        }
        try:
            res = await self._send_request(
                "PUT", f"/rest/api/3/issue/{issue_key}/comment/{comment_id}", json=payload
            )
            self._handle_response_errors(res)
            return self._parse_comment(res.json())
        except httpx.RequestError as exc:
            raise JiraAPIError(
                f"Failed to connect to Jira: {self._format_request_error(exc)}", status_code=503
            ) from exc

    async def delete_comment(self, issue_key: str, comment_id: str) -> bool:
        """Delete an existing comment via Jira Cloud REST API."""
        try:
            res = await self._send_request(
                "DELETE", f"/rest/api/3/issue/{issue_key}/comment/{comment_id}"
            )
            if res.status_code == 204 or res.is_success:
                return True
            self._handle_response_errors(res)
            return True
        except httpx.RequestError as exc:
            raise JiraAPIError(
                f"Failed to connect to Jira: {self._format_request_error(exc)}", status_code=503
            ) from exc
