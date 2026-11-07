package app.capgo.capacitor.fastsql;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Keeps all entry points on one database thread, including transaction boundaries. */
final class SerializedDatabase implements DatabaseConnection {

    private final DatabaseConnection delegate;
    private final ExecutorService executor = new ThreadPoolExecutor(
        1,
        1,
        0,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(256),
        (runnable) -> {
            Thread thread = new Thread(runnable, "FastSQL-Database");
            thread.setDaemon(true);
            return thread;
        }
    );

    SerializedDatabase(DatabaseConnection delegate) {
        this.delegate = delegate;
    }

    private <T> T call(Callable<T> operation) throws Exception {
        try {
            return executor.submit(operation).get(600, TimeUnit.SECONDS);
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw new RuntimeException(cause);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw error;
        }
    }

    public JSObject execute(String statement, JSArray params) throws Exception {
        return call(() -> delegate.execute(statement, params));
    }

    public void beginTransaction() throws Exception {
        call(() -> {
            delegate.beginTransaction();
            return null;
        });
    }

    public void commitTransaction() throws Exception {
        call(() -> {
            delegate.commitTransaction();
            return null;
        });
    }

    public void rollbackTransaction() throws Exception {
        call(() -> {
            delegate.rollbackTransaction();
            return null;
        });
    }

    public boolean isReadOnly() {
        return delegate.isReadOnly();
    }

    public void close() {
        try {
            call(() -> {
                delegate.close();
                return null;
            });
        } catch (Exception error) {
            throw new IllegalStateException("Failed to close database", error);
        } finally {
            executor.shutdown();
        }
    }
}
