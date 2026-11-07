package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import org.junit.Test;

public class RequestBodyLengthTest {

    @Test
    public void validatesBeforeAllocatingMemory() throws Exception {
        assertEquals(0, SQLHTTPServer.requestBodyLength(null));
        assertEquals(0, SQLHTTPServer.requestBodyLength("0"));
        assertEquals(64 * 1024 * 1024, SQLHTTPServer.requestBodyLength("67108864"));
        for (String invalid : new String[] { "-1", "67108865", "2147483648", "9999999999999999999999999", "not-a-number" }) {
            assertThrows(IOException.class, () -> SQLHTTPServer.requestBodyLength(invalid));
        }
    }
}
