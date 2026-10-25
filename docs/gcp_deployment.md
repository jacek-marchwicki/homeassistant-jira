# Google Cloud Platform (GCP) & Gemini MCP Deployment Guide

This guide details how to deploy the **Home Assistant Jira Dashboard** and its built-in **Model Context Protocol (MCP) Server** to **Google Cloud Run**, protected by Google OAuth 2.0 and restricted to four specified family Gmail accounts, while remaining 100% within GCP's **Always Free Tier** ($0/month under typical usage, with a hard guarantee never to exceed $2 USD/month).

---

## 1. Architectural Highlights & Principles

1. **Dual-Deployment First**:
   - The application runs identically on **Google Cloud Run** or as a **Home Assistant Add-on** (with Ingress).
   - The authentication layer dynamically switches between `homeassistant` (Ingress headers) and `gcp_oauth` (Google OAuth 2.0 Bearer tokens and session cookies).
2. **Unified Single Container**:
   - The React 19 frontend and the Python FastAPI backend (serving both the Jira REST API, WebSockets, and the MCP endpoints) are packaged in a single Docker image.
3. **Gemini on Web Native MCP**:
   - Exposes standard Model Context Protocol endpoints:
     - **SSE Transport**: `GET /sse` and `POST /messages?session_id=...`
     - **Streamable HTTP Transport**: `POST /mcp`
   - Gemini on web (`gemini.com`) connects securely using your OAuth 2.0 Client ID and Client Secret.
4. **Privacy & Zero Secret Leakage**:
   - No email addresses or secrets are stored in Git.
   - All credentials and allowed user lists are stored in **Google Cloud Secret Manager** and mounted into Cloud Run at runtime.

---

## 2. Cost Control & Free Tier Guarantee (< $2 USD / Month)

To guarantee you never pay more than **$2 USD/month** (and typically **$0.00**), the deployment strictly uses serverless, scale-to-zero compute:

| Service | GCP Free Tier Allowance | How We Keep It Free |
| :--- | :--- | :--- |
| **Cloud Run** | • 2,000,000 requests / month<br/>• 360,000 vCPU-seconds / month<br/>• 180,000 GiB-seconds / month | • **Scale to Zero**: `--min-instances 0` (zero compute when idle).<br/>• **CPU Throttling**: CPU is only allocated and billed during active request processing.<br/>• **Instance Cap**: `--max-instances 2` to prevent runaway traffic spikes. |
| **Cloud Firestore** | • 50,000 document reads / day<br/>• 20,000 document writes / day<br/>• 1 GiB stored data free | Serverless NoSQL document database storing board metadata, offline mutations, OAuth sessions, and image metadata. Zero provisioned instances or idle fees. |
| **Cloud Storage** | • 5 GiB standard storage / month<br/>• 5,000 Class A operations / month<br/>• 50,000 Class B operations / month | Direct SDK blob storage for AI-generated task background WebP images, completely avoiding FUSE mounts and file locks. |
| **Secret Manager** | • 6 active secret versions free / month<br/>• 10,000 access operations free / month | We use ~5 secrets, well within the free tier. |
| **Cloud Build** | • 120 build-minutes free / day | Container builds take ~1 to 2 minutes. |
| **Networking** | Direct Cloud Run HTTPS | **We DO NOT use an external HTTP(S) Load Balancer** (which costs ~$18/month). Cloud Run provides free, fully-managed TLS certificates automatically. |

### Recommended: Set a $2.00 Budget Alert
1. In the Google Cloud Console, open **Billing > Budgets & alerts**.
2. Click **Create Budget**.
3. Set the target amount to **$2.00 USD**.
4. Set threshold rules at 50% ($1.00), 90% ($1.80), and 100% ($2.00) with email notifications.

---

## 3. Step-by-Step Setup Guide

### Step 1: Install & Authenticate Google Cloud SDK
Ensure the `gcloud` CLI is installed and authenticated:
```bash
# Check version
gcloud version

# Log in with your Google account
gcloud auth login
```

### Step 2: Configure OAuth Consent Screen & Whitelist 4 Users
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create your GCP project (e.g., `family-jira-dashboard`).
3. Navigate to **APIs & Services > OAuth consent screen** (or **Google Auth Platform**).
4. Select User Type: **External** and click **Create**.
5. Fill in the App Name (e.g. `Family Jira Assistant`) and user support email.
6. Leave Publishing Status as **Testing** (Do NOT click "Publish App").
   > [!IMPORTANT]
   > While in **Testing** mode, Google automatically restricts access exclusively to listed test users. Any unlisted Google account is blocked by Google with `Error 403: access_denied` before reaching your service.
7. Under **Test users**, click **Add Users** and enter your four authorized Gmail accounts:
   - `user1@gmail.com`
   - `user2@gmail.com`
   - `user3@gmail.com`
   - `user4@gmail.com`
8. Save and finish.

### Step 3: Create OAuth 2.0 Web Client Credentials
1. In the GCP Console, navigate to **APIs & Services > Credentials**.
2. Click **Create Credentials > OAuth client ID**.
3. Select Application type: **Web application**.
4. Name: `Gemini and Dashboard Client`.
5. Checkbox **"Use this client for an AI-powered agent"**:
   - **Leave this unchecked**. Google recommends standard "Web application" clients for dual-purpose applications serving both human browser users (the web dashboard) and AI tools.
6. **Authorized JavaScript origins**:
   - `http://localhost:8000`
   - `http://localhost:3000`
   - `https://<your-service>-<hash>.a.run.app` (e.g. `https://home-taskmanager-4ln37ygzvq-ew.a.run.app`)
7. **Authorized redirect URIs**:
   - *Note on Google restriction*: Google will reject internal Google domains (such as `oauth.googleusercontent.com` or `accounts.google.com`) with *"Invalid Redirect: uses a forbidden domain"*.
   - **For web dashboard login**:
     - `http://localhost:8000/api/auth/google/callback` (for local dev)
     - `https://<your-service>-<hash>.a.run.app/api/auth/google/callback` (e.g. `https://home-taskmanager-4ln37ygzvq-ew.a.run.app/api/auth/google/callback`)
   - **For Gemini on Web**: If Gemini's MCP setup dialog displays a specific callback URI (such as `https://vertexaisearch.cloud.google.com/oauth-redirect`), add that URI here.
8. Click **Create** and copy your **Client ID** and **Client Secret**.

### Step 4: Create Local `.env.gcp` Configuration
Copy the template file to `.env.gcp` (which is strictly ignored by Git):
```bash
cp .env.gcp.example .env.gcp
```

Edit `.env.gcp` and fill in your actual values:
```env
# 1. Google Cloud Project & Service Configuration
GCP_PROJECT_ID=your-gcp-project-id
GCP_REGION=europe-west1
GCP_SERVICE_NAME=homeassistant-jira

# 2. Authorized Family Gmail Accounts (comma-separated, NO spaces)
ALLOWED_EMAILS=user1@gmail.com,user2@gmail.com,user3@gmail.com,user4@gmail.com

# 3. Google OAuth 2.0 Web Client Credentials
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# 4. Jira Cloud Credentials
JIRA_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-jira-account@example.com
JIRA_API_TOKEN=your-jira-api-token
JIRA_BOARD_ID=engineering-1
```

---

## 4. Single-Command Deployment via Python

All deployment steps are automated using the type-safe Python deployment utility [`scripts/deploy_gcp.py`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/scripts/deploy_gcp.py):

### 1. Sync Secrets & Infrastructure (First time or when credentials change)
```bash
python3 scripts/deploy_gcp.py sync-secrets
```
This command:
- Enables Cloud Run, Secret Manager, Cloud Build, Artifact Registry, Cloud Firestore, and Cloud Storage APIs.
- Provisions the Google Cloud Storage bucket for AI image backgrounds with uniform bucket-level access.
- Grants Firestore (`roles/datastore.user`) and Cloud Storage (`roles/storage.objectAdmin`) permissions to Cloud Run's default service account.
- Uploads and encrypts all credentials in GCP Secret Manager.
- Grants read access to Cloud Run's default service account.

### 2. Deploy to Cloud Run
```bash
python3 scripts/deploy_gcp.py deploy
```
This command:
- Runs pre-deployment local CI verification ([`scripts/run_ci_locally.py`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/scripts/run_ci_locally.py)).
- Submits the container build to Cloud Build.
- Deploys the service to Cloud Run with scale-to-zero, memory limits (512Mi), and secret bindings.
- Outputs your public HTTPS URLs.

### 3. Check Service Health & Status
```bash
python3 scripts/deploy_gcp.py status
```

---

## 5. Connecting Gemini on Web (`gemini.com` / Custom Apps)

Once deployed, connect Gemini to your custom Jira MCP server:

1. Open **[gemini.google.com](https://gemini.google.com/)** in your browser.
2. Go to **Settings > Connected Apps > Custom apps > Add a custom app**.
3. In the setup dialog:
   - **Server URL**: `https://<your-cloud-run-service-url>/mcp`
   - **Authentication**: **OAuth 2.0**
   - **Client ID**: `gemini-mcp-client` (or value of `MCP_CLIENT_ID` if customized)
   - **Client Secret**: Leave blank unless `MCP_CLIENT_SECRET` was configured in Cloud Run
4. Click **Connect** (or **Next**):
   - Gemini automatically discovers the OAuth endpoints from `/.well-known/oauth-authorization-server` and redirects your browser to authorize access.
   - If not already signed in, sign in with your allowed Google account (`ALLOWED_EMAILS`).
   - You will be redirected back to Gemini, completing the connection!

> [!NOTE]
> The server implements **RFC 9728** and **RFC 8414** discovery metadata (`/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`) and standard OAuth 2.0 authorization code flow (`/oauth/authorize` and `/oauth/token`). Access to all Jira tools is protected and restricted strictly to the emails configured in `ALLOWED_EMAILS`.

### Available MCP Tools Exposed to Gemini & AI Clients:
- `home_tasks_get_board`: Retrieve active board tasks grouped by person, active filter, and task summaries.
- `home_tasks_list_users`: List assignable users and account types.
- `home_tasks_list_tasks`: Search and filter tasks across the board.
- `home_tasks_get_task`: Get detailed specifications, descriptions, and comments for any task (`HOME-101`).
- `home_tasks_create_task`: Create chores, tasks, or bugs with summary, description, and board metadata.
- `home_tasks_edit_task`: Edit existing tasks (title, description, status, priority, assignee, dates, recurring schedule, estimate).
- `home_tasks_assign_task`: Assign or unassign tasks.
- `home_tasks_transition_task`: Move tasks between `todo`, `in_progress`, and `done`.
- `home_tasks_add_comment`: Post comments directly to tasks.

---

## 6. Accessing the Jira Web Dashboard

Open the deployed Cloud Run URL directly in any desktop, tablet, or smartphone browser:
```
https://<your-cloud-run-service-url>/
```
- Visitors are authenticated via Google OAuth 2.0.
- Only the 4 authorized accounts in `ALLOWED_EMAILS` will be granted access to view the dashboard and manage tasks.
