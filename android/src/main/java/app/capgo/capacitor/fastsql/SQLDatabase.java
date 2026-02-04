package app.capgo.capacitor.fastsql;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * SQLite database wrapper for Android
 */
public class SQLDatabase implements DatabaseConnection {

    private SQLiteDatabase db;
    private boolean inTransaction = false;

    public SQLDatabase(String path) {
        this.db = SQLiteDatabase.openOrCreateDatabase(path, null);
        // Enable foreign keys
        db.execSQL("PRAGMA foreign_keys = ON");
    }

    public void close() {
        if (db != null && db.isOpen()) {
            db.close();
        }
    }

    public JSObject execute(String statement, JSArray params) throws Exception {
        if (db == null || !db.isOpen()) {
            throw new Exception("Database is not open");
        }

        // Check if this is a query (SELECT) or a modification (INSERT/UPDATE/DELETE)
        String trimmedStatement = statement.trim().toUpperCase();
        boolean isQuery =
            trimmedStatement.startsWith("SELECT") || trimmedStatement.startsWith("PRAGMA") || trimmedStatement.startsWith("EXPLAIN");

        if (isQuery) {
            return executeQuery(statement, params);
        } else {
            return executeUpdate(statement, params);
        }
    }

    private JSObject executeQuery(String statement, JSArray params) throws Exception {
        Cursor cursor = null;
        try {
            // Prepare statement with parameters
            String[] bindArgs = convertParamsToStringArray(params);
            cursor = db.rawQuery(statement, bindArgs);

            // Build result
            JSArray rows = new JSArray();
            while (cursor.moveToNext()) {
                JSObject row = new JSObject();
                for (int i = 0; i < cursor.getColumnCount(); i++) {
                    String columnName = cursor.getColumnName(i);
                    Object value = getColumnValue(cursor, i);
                    row.put(columnName, value);
                }
                rows.put(row);
            }

            JSObject result = new JSObject();
            result.put("rows", rows);
            result.put("rowsAffected", 0);
            return result;
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    private JSObject executeUpdate(String statement, JSArray params) throws Exception {
        SQLiteStatement stmt = null;
        try {
            stmt = db.compileStatement(statement);

            // Bind parameters
            bindParams(stmt, params);

            // Execute
            long result;
            if (statement.trim().toUpperCase().startsWith("INSERT")) {
                result = stmt.executeInsert();
            } else {
                stmt.execute();
                result = -1;
            }

            // Get affected rows
            int changes = (int) db.compileStatement("SELECT changes()").simpleQueryForLong();

            JSObject ret = new JSObject();
            ret.put("rows", new JSArray());
            ret.put("rowsAffected", changes);
            if (result > 0) {
                ret.put("insertId", result);
            }
            return ret;
        } finally {
            if (stmt != null) {
                stmt.close();
            }
        }
    }

    public void beginTransaction() throws Exception {
        if (inTransaction) {
            throw new Exception("Transaction already active");
        }
        db.beginTransaction();
        inTransaction = true;
    }

    public void commitTransaction() throws Exception {
        if (!inTransaction) {
            throw new Exception("No transaction active");
        }
        db.setTransactionSuccessful();
        db.endTransaction();
        inTransaction = false;
    }

    public void rollbackTransaction() throws Exception {
        if (!inTransaction) {
            throw new Exception("No transaction active");
        }
        db.endTransaction();
        inTransaction = false;
    }

    private String[] convertParamsToStringArray(JSArray params) throws JSONException {
        if (params == null || params.length() == 0) {
            return null;
        }

        List<String> args = new ArrayList<>();
        for (int i = 0; i < params.length(); i++) {
            Object value = params.get(i);
            if (value == null || value == JSONObject.NULL) {
                args.add(null);
            } else if (value instanceof JSONObject) {
                JSONObject obj = (JSONObject) value;
                if (obj.has("_type") && "binary".equals(obj.getString("_type"))) {
                    // For queries, we can't bind binary data as string
                    // This is a limitation - for binary data, use executeUpdate
                    args.add(obj.getString("_data"));
                } else {
                    args.add(value.toString());
                }
            } else {
                args.add(value.toString());
            }
        }
        return args.toArray(new String[0]);
    }

    private void bindParams(SQLiteStatement stmt, JSArray params) throws Exception {
        if (params == null || params.length() == 0) {
            return;
        }

        for (int i = 0; i < params.length(); i++) {
            Object value = params.get(i);
            int index = i + 1; // SQLite parameters are 1-indexed

            if (value == null || value == JSONObject.NULL) {
                stmt.bindNull(index);
            } else if (value instanceof String) {
                stmt.bindString(index, (String) value);
            } else if (value instanceof Integer) {
                stmt.bindLong(index, ((Integer) value).longValue());
            } else if (value instanceof Long) {
                stmt.bindLong(index, (Long) value);
            } else if (value instanceof Double) {
                stmt.bindDouble(index, (Double) value);
            } else if (value instanceof Float) {
                stmt.bindDouble(index, ((Float) value).doubleValue());
            } else if (value instanceof Boolean) {
                stmt.bindLong(index, ((Boolean) value) ? 1 : 0);
            } else if (value instanceof JSONObject) {
                JSONObject obj = (JSONObject) value;
                if (obj.has("_type") && "binary".equals(obj.getString("_type"))) {
                    // Handle binary data
                    String base64 = obj.getString("_data");
                    byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                    stmt.bindBlob(index, bytes);
                } else {
                    stmt.bindString(index, value.toString());
                }
            } else {
                stmt.bindString(index, value.toString());
            }
        }
    }

    private Object getColumnValue(Cursor cursor, int index) {
        int type = cursor.getType(index);
        switch (type) {
            case Cursor.FIELD_TYPE_NULL:
                return JSONObject.NULL;
            case Cursor.FIELD_TYPE_INTEGER:
                return cursor.getLong(index);
            case Cursor.FIELD_TYPE_FLOAT:
                return cursor.getDouble(index);
            case Cursor.FIELD_TYPE_STRING:
                return cursor.getString(index);
            case Cursor.FIELD_TYPE_BLOB:
                byte[] blob = cursor.getBlob(index);
                String base64 = Base64.encodeToString(blob, Base64.NO_WRAP);
                JSObject blobObj = new JSObject();
                blobObj.put("_type", "binary");
                blobObj.put("_data", base64);
                return blobObj;
            default:
                return JSONObject.NULL;
        }
    }
}
