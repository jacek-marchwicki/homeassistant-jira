"""In-memory mock/test double for Google Cloud Firestore.

Implements document, collection, query, and atomic increment operations
without requiring external network connections or GCP credentials.
"""

from __future__ import annotations

import copy
from typing import Any


class Increment:
    """Emulates google.cloud.firestore.Increment."""

    def __init__(self, value: int | float) -> None:
        self.value = value


class FakeDocumentSnapshot:
    """Emulates google.cloud.firestore.DocumentSnapshot."""

    def __init__(self, doc_id: str, data: dict[str, Any] | None) -> None:
        self.id = doc_id
        self._data = copy.deepcopy(data) if data is not None else None

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return copy.deepcopy(self._data) if self._data is not None else None


class FakeQuery:
    """Emulates Firestore collection queries (where filters, ordering)."""

    def __init__(
        self,
        collection: FakeCollectionReference,
        filters: list[tuple[str, str, Any]] | None = None,
    ) -> None:
        self._collection = collection
        self._filters: list[tuple[str, str, Any]] = list(filters or [])
        self._order_by_field: str | None = None
        self._descending: bool = False

    def where(self, field_path: str, op_string: str, value: Any) -> FakeQuery:
        new_q = FakeQuery(self._collection, self._filters + [(field_path, op_string, value)])
        new_q._order_by_field = self._order_by_field
        new_q._descending = self._descending
        return new_q

    def order_by(self, field_path: str, direction: str = "ASCENDING") -> FakeQuery:
        new_q = FakeQuery(self._collection, self._filters)
        new_q._order_by_field = field_path
        new_q._descending = direction.upper() in ("DESC", "DESCENDING")
        return new_q

    def stream(self) -> list[FakeDocumentSnapshot]:
        docs: list[FakeDocumentSnapshot] = []
        for doc_id, data in self._collection._data.items():
            match = True
            for field, op, val in self._filters:
                doc_val = data.get(field)
                if op == "==" and doc_val != val:
                    match = False
                    break
                elif op == ">" and not (doc_val is not None and doc_val > val):
                    match = False
                    break
                elif op == "<" and not (doc_val is not None and doc_val < val):
                    match = False
                    break
                elif op == ">=" and not (doc_val is not None and doc_val >= val):
                    match = False
                    break
                elif op == "<=" and not (doc_val is not None and doc_val <= val):
                    match = False
                    break
            if match:
                docs.append(FakeDocumentSnapshot(doc_id, data))

        if self._order_by_field:
            docs.sort(
                key=lambda d: (d.to_dict() or {}).get(self._order_by_field) or 0,
                reverse=self._descending,
            )
        return docs


class FakeDocumentReference:
    """Emulates google.cloud.firestore.DocumentReference."""

    def __init__(self, doc_id: str, collection: FakeCollectionReference) -> None:
        self.id = doc_id
        self._collection = collection

    def get(self) -> FakeDocumentSnapshot:
        data = self._collection._data.get(self.id)
        return FakeDocumentSnapshot(self.id, data)

    def set(self, document_data: dict[str, Any], merge: bool = False) -> None:
        if merge and self.id in self._collection._data:
            current = self._collection._data[self.id]
            current.update(copy.deepcopy(document_data))
        else:
            self._collection._data[self.id] = copy.deepcopy(document_data)

    def update(self, field_updates: dict[str, Any]) -> None:
        if self.id not in self._collection._data:
            raise KeyError(f"Document {self.id} does not exist to update")
        target = self._collection._data[self.id]
        for k, v in field_updates.items():
            if isinstance(v, Increment):
                target[k] = (target.get(k) or 0) + v.value
            else:
                target[k] = copy.deepcopy(v)

    def delete(self) -> None:
        self._collection._data.pop(self.id, None)


class FakeCollectionReference:
    """Emulates google.cloud.firestore.CollectionReference."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._data: dict[str, dict[str, Any]] = {}

    def document(self, document_id: str | None = None) -> FakeDocumentReference:
        if not document_id:
            import uuid

            document_id = str(uuid.uuid4())
        return FakeDocumentReference(document_id, self)

    def where(self, field_path: str, op_string: str, value: Any) -> FakeQuery:
        return FakeQuery(self).where(field_path, op_string, value)

    def order_by(self, field_path: str, direction: str = "ASCENDING") -> FakeQuery:
        return FakeQuery(self).order_by(field_path, direction)

    def stream(self) -> list[FakeDocumentSnapshot]:
        return [FakeDocumentSnapshot(k, v) for k, v in list(self._data.items())]


class FakeFirestoreClient:
    """Emulates google.cloud.firestore.Client."""

    def __init__(self, project: str = "test-project", database: str = "(default)") -> None:
        self.project = project
        self.database = database
        self._collections: dict[str, FakeCollectionReference] = {}

    def collection(self, collection_name: str) -> FakeCollectionReference:
        if collection_name not in self._collections:
            self._collections[collection_name] = FakeCollectionReference(collection_name)
        return self._collections[collection_name]

    def close(self) -> None:
        pass
