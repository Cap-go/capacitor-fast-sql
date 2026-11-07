package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import org.junit.Test;

public class SQLHTTPServerTest {

    @Test
    public void bindsOnlyIpv4LoopbackAndLetsOsChoosePort() throws Exception {
        SQLHTTPServer server = new SQLHTTPServer(new HashMap<>());
        try {
            assertEquals("127.0.0.1", server.getHostname());
            server.start();
            assertTrue(server.getPort() > 0);
        } finally {
            server.stop();
        }
    }
}
