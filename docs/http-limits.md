# HTTP request limits

Android accepts request bodies up to 64 MiB, including JSON and base64 overhead.
It rejects negative, malformed, overflowing, and larger Content-Length values
before allocating the body buffer. Missing Content-Length means an empty body,
which supports bodyless transaction commit/rollback requests. Chunked bodies are
unsupported and rejected. Split large write batches before sending them.

This limit does not bound the size of SQL results or the iOS Telegraph parser's
allocations. It also does not cancel database execution. Request/result streaming,
protocol-level deadlines, and iOS parser limits require separate work.
