"""In-memory mock/test double for Google Cloud Storage client library."""

from __future__ import annotations


class FakeNotFound(Exception):
    """Emulates google.cloud.exceptions.NotFound."""

    pass


class FakeBlob:
    """Emulates google.cloud.storage.Blob."""

    def __init__(self, name: str, bucket: FakeBucket) -> None:
        self.name = name
        self.bucket = bucket

    def upload_from_string(self, data: bytes, content_type: str = "image/webp") -> None:
        self.bucket._blobs[self.name] = (data, content_type)

    def download_as_bytes(self) -> bytes:
        if self.name not in self.bucket._blobs:
            raise FakeNotFound(f"Blob {self.name} not found")
        return self.bucket._blobs[self.name][0]

    def exists(self) -> bool:
        return self.name in self.bucket._blobs

    def delete(self) -> None:
        if self.name not in self.bucket._blobs:
            raise FakeNotFound(f"Blob {self.name} not found")
        del self.bucket._blobs[self.name]


class FakeBucket:
    """Emulates google.cloud.storage.Bucket."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._blobs: dict[str, tuple[bytes, str]] = {}

    def blob(self, blob_name: str) -> FakeBlob:
        return FakeBlob(blob_name, self)


class FakeGCSClient:
    """Emulates google.cloud.storage.Client."""

    def __init__(self, project: str = "test-project") -> None:
        self.project = project
        self._buckets: dict[str, FakeBucket] = {}

    def bucket(self, bucket_name: str) -> FakeBucket:
        if bucket_name not in self._buckets:
            self._buckets[bucket_name] = FakeBucket(bucket_name)
        return self._buckets[bucket_name]
