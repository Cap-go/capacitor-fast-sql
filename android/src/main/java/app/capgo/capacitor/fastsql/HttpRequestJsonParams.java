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
            Object converted = convertRequestParam(paramsJson.get(i));
            if (converted != null) {
                params.put(converted);
            }
        }
    }

    /**
     * Converts one JSON param value for {@link JSArray#put(Object)}.
     *
     * @return converted value, or {@code null} to skip unsupported values (e.g. nested arrays)
     */
    static Object convertRequestParam(Object param) {
        if (param == JSONObject.NULL) {
            return JSONObject.NULL;
        }
        if (param instanceof Boolean) {
            return param;
        }
        if (param instanceof Number) {
            return convertNumberLikeGson((Number) param);
        }
        if (param instanceof String) {
            return param;
        }
        if (param instanceof JSONObject) {
            JSONObject obj = (JSONObject) param;
            JSONObject jsonObj = new JSONObject();
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                try {
                    jsonObj.put(key, elementGetAsString(obj.get(key)));
                } catch (JSONException e) {
                    throw new IllegalStateException(e);
                }
            }
            return jsonObj;
        }
        return null;
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
    static Number convertNumberLikeGson(Number number) {
        String s = numberToJsonNumberString(number);
        try {
            return gsonStyleLongFromNumberString(s);
        } catch (NumberFormatException e) {
            return gsonStyleDoubleFromNumberString(s, number);
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
