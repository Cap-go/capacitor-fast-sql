package app.capgo.capacitor.fastsql;

import com.getcapacitor.JSArray;
import java.math.BigDecimal;
import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Converts HTTP request JSON parameter arrays to {@link JSArray} values with the same
 * semantics as the previous Gson-based parsing in {@link SQLHTTPServer}.
 */
final class HttpRequestJsonParams {

    private HttpRequestJsonParams() {}

    static void populateJsArrayFromParamsJson(JSONArray paramsJson, JSArray params) throws JSONException {
        for (int i = 0; i < paramsJson.length(); i++) {
            appendParam(params, paramsJson.get(i));
        }
    }

    static void appendParam(JSArray params, Object param) throws JSONException {
        if (param == JSONObject.NULL) {
            params.put(JSONObject.NULL);
        } else if (param instanceof Boolean) {
            params.put(param);
        } else if (param instanceof Number) {
            putNumberLikeGson(params, (Number) param);
        } else if (param instanceof String) {
            params.put(param);
        } else if (param instanceof JSONObject) {
            JSONObject obj = (JSONObject) param;
            JSONObject jsonObj = new JSONObject();
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                jsonObj.put(key, elementGetAsString(obj.get(key)));
            }
            params.put(jsonObj);
        }
    }

    /** Mirrors Gson {@code JsonElement#getAsString()} for object field values. */
    static String elementGetAsString(Object value) {
        if (value == null || value == JSONObject.NULL) {
            throw new IllegalStateException("Cannot get string from null");
        }
        if (value instanceof String) {
            return (String) value;
        }
        return String.valueOf(value);
    }

    /**
     * Mirrors Gson {@code JsonPrimitive#getAsLong()} with {@code getAsDouble()} fallback on
     * {@link NumberFormatException}, using LazilyParsedNumber-style parsing on the number's text.
     */
    static void putNumberLikeGson(JSArray params, Number number) throws JSONException {
        String s = numberToJsonNumberString(number);
        try {
            params.put(gsonStyleLongFromNumberString(s));
        } catch (NumberFormatException e) {
            params.put(gsonStyleDoubleFromNumberString(s, number));
        }
    }

    static long gsonStyleLongFromNumberString(String s) {
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            return (long) Double.parseDouble(s);
        }
    }

    static double gsonStyleDoubleFromNumberString(String s, Number number) {
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return number.doubleValue();
        }
    }

    static String numberToJsonNumberString(Number number) {
        if (number instanceof BigDecimal) {
            return ((BigDecimal) number).toPlainString();
        }
        return number.toString();
    }
}
