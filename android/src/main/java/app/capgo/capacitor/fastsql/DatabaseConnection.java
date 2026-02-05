package app.capgo.capacitor.fastsql;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

public interface DatabaseConnection {
    JSObject execute(String statement, JSArray params) throws Exception;

    void beginTransaction() throws Exception;

    void commitTransaction() throws Exception;

    void rollbackTransaction() throws Exception;

    void close();
}
