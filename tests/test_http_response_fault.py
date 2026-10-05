"""Synthetic byte streams only: verify the forwarding harness preserves HTTP request bodies."""

import io
import unittest
from types import SimpleNamespace

from tools.http_response_fault import read_request_body


class HttpResponseFaultTests(unittest.TestCase):
    def test_content_length_body_is_preserved(self):
        body = b'{"synthetic":true}'
        handler = SimpleNamespace(headers={"Content-Length": str(len(body))}, rfile=io.BytesIO(body))
        self.assertEqual(read_request_body(handler), body)

    def test_chunked_body_extensions_and_trailers_are_decoded(self):
        stream = b'7;synthetic=yes\r\n{"score\r\n6\r\n":0.7}\r\n0\r\nX-Synthetic: yes\r\n\r\n'
        handler = SimpleNamespace(headers={"Transfer-Encoding": "chunked"}, rfile=io.BytesIO(stream))
        self.assertEqual(read_request_body(handler), b'{"score":0.7}')

    def test_truncated_chunk_is_rejected(self):
        handler = SimpleNamespace(headers={"Transfer-Encoding": "chunked"}, rfile=io.BytesIO(b'8\r\nshort\r\n'))
        with self.assertRaisesRegex(ValueError, "invalid synthetic HTTP chunk"):
            read_request_body(handler)


if __name__ == "__main__":
    unittest.main()
