package app.capgo.capacitor.fastsql;

import static org.junit.Assert.assertEquals;

import com.getcapacitor.JSArray;
import java.io.File;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class SerializedDatabaseTest {

    @Test
    public void transactionSurvivesDifferentCallerThreads() throws Exception {
        File file = File.createTempFile("fast-sql-serialized", ".db");
        file.deleteOnExit();
        SerializedDatabase database = new SerializedDatabase(new SQLDatabase(file.getAbsolutePath(), false, false));
        try {
            database.execute("CREATE TABLE sample (value TEXT)", new JSArray());
            database.beginTransaction();
            java.util.concurrent.ExecutorService otherCaller = java.util.concurrent.Executors.newSingleThreadExecutor();
            try {
                otherCaller
                    .submit(() -> {
                        database.execute("INSERT INTO sample VALUES ('x')", new JSArray());
                        database.rollbackTransaction();
                        return null;
                    })
                    .get();
            } finally {
                otherCaller.shutdownNow();
            }
            assertEquals(0, database.execute("SELECT * FROM sample", new JSArray()).getJSONArray("rows").length());
        } finally {
            database.close();
        }
    }
}
