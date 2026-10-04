package app.capgo.capacitor.fastsql;

import com.getcapacitor.JSArray;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Converts HTTP request JSON parameter arrays to {@link JSArray} values with the same
 * semantics as the previous Gson-based parsing in {@link SQLHTTPServer}.
 */
final class HttpRequestJsonParams {

    private static final int MAX_NUMBER_STRING_LENGTH = 10_000;

    private HttpRequestJsonParams() {}

    static void populateJsArrayFromParamsJson(JSONArray paramsJson, JSArray params) throws JSONException {
        populateJsArrayFromParamsJson(paramsJson, params, null);
    }

    static void populateJsArrayFromParamsJson(JSONArray paramsJson, JSArray params, String rawParamsArrayJson) throws JSONException {
        List<String> rawElements = rawParamsArrayJson != null ? splitTopLevelJsonArrayElements(rawParamsArrayJson) : null;
        for (int i = 0; i < paramsJson.length(); i++) {
            String rawElement = rawElements != null && i < rawElements.size() ? rawElements.get(i) : null;
            Object converted =
                rawElement != null ? convertRequestParamFromRawJson(rawElement, paramsJson.get(i)) : convertRequestParam(paramsJson.get(i));
            if (converted != null) {
                params.put(converted);
            }
        }
    }

    static String extractJsonArrayAfterKey(String json, String key) throws JSONException {
        int i = skipWhitespace(json, 0);
        if (i >= json.length() || json.charAt(i) != '{') {
            throw new JSONException("Expected JSON object");
        }
        i++;
        String found = null;
        while (i < json.length()) {
            i = skipWhitespace(json, i);
            if (json.charAt(i) == '}') {
                if (found != null) {
                    return found;
                }
                throw new JSONException("No key: " + key);
            }
            int keyEnd = endOfJsonString(json, i);
            String memberKey = parseQuotedStringToken(json, i, keyEnd);
            i = skipWhitespace(json, keyEnd);
            if (json.charAt(i) != ':') {
                throw new JSONException("Expected ':' after object key");
            }
            i = skipWhitespace(json, i + 1);
            if (memberKey.equals(key)) {
                i = skipWhitespace(json, i);
                if (i >= json.length() || json.charAt(i) != '[') {
                    throw new JSONException("No array for key: " + key);
                }
                int end = indexOfMatchingBracket(json, i, '[', ']');
                found = json.substring(i, end + 1);
                i = end + 1;
            } else {
                i = endOfJsonValue(json, i);
            }
            i = skipWhitespace(json, i);
            if (i < json.length() && json.charAt(i) == ',') {
                i++;
            }
        }
        if (found != null) {
            return found;
        }
        throw new JSONException("No key: " + key);
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

    static Object convertRequestParamFromRawJson(String rawElement, Object parsedFallback) {
        String raw = rawElement.trim();
        if (raw.startsWith("{")) {
            return convertFlatObjectParamFromRawJson(raw);
        }
        if (raw.startsWith("[")) {
            return null;
        }
        if (raw.equals("null")) {
            return JSONObject.NULL;
        }
        if (raw.equals("true") || raw.equals("false")) {
            return Boolean.parseBoolean(raw);
        }
        if (raw.startsWith("\"")) {
            try {
                return new JSONTokener(raw).nextValue();
            } catch (JSONException e) {
                throw new IllegalStateException(e);
            }
        }
        return convertNumberLikeGsonFromLiteral(raw);
    }

    /** Mirrors Gson {@code JsonElement#getAsString()} for object field values. */
    static String elementGetAsString(Object value) {
        if (value == null || value == JSONObject.NULL) {
            throw new IllegalStateException("Cannot get string from null");
        }
        if (value instanceof String) {
            return (String) value;
        }
        if (value instanceof Number) {
            try {
                return JSONObject.numberToString((Number) value);
            } catch (JSONException e) {
                throw new IllegalStateException(e);
            }
        }
        if (value instanceof Boolean) {
            return value.toString();
        }
        if (value instanceof JSONObject || value instanceof JSONArray) {
            throw new IllegalStateException("Cannot get string from non-primitive");
        }
        return String.valueOf(value);
    }

    static String elementGetAsStringFromRawToken(String token) {
        String raw = token.trim();
        if (raw.equals("null")) {
            throw new IllegalStateException("Cannot get string from null");
        }
        if (raw.startsWith("{") || raw.startsWith("[")) {
            throw new IllegalStateException("Cannot get string from non-primitive");
        }
        if (raw.startsWith("\"")) {
            try {
                Object value = new JSONTokener(raw).nextValue();
                if (value instanceof String) {
                    return (String) value;
                }
            } catch (JSONException e) {
                throw new IllegalStateException(e);
            }
        }
        if (raw.equals("true") || raw.equals("false")) {
            return raw;
        }
        return raw;
    }

    /**
     * Mirrors Gson {@code JsonPrimitive#getAsLong()} with {@code getAsDouble()} fallback on
     * {@link NumberFormatException}, using LazilyParsedNumber-style parsing on the number's text.
     */
    static Number convertNumberLikeGson(Number number) {
        return convertNumberLikeGsonFromLiteral(numberToJsonNumberString(number));
    }

    static Number convertNumberLikeGsonFromLiteral(String literal) {
        try {
            return gsonStyleLongFromNumberString(literal);
        } catch (NumberFormatException e) {
            return gsonStyleDoubleFromNumberString(literal, Double.parseDouble(literal));
        }
    }

    static long gsonStyleLongFromNumberString(String s) {
        checkNumberStringLength(s);
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            return parseBigDecimalLikeGson(s).longValue();
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

    static JSONObject convertFlatObjectParamFromRawJson(String raw) {
        JSONObject out = new JSONObject();
        int i = skipWhitespace(raw, 1);
        while (true) {
            i = skipWhitespace(raw, i);
            if (raw.charAt(i) == '}') {
                break;
            }
            int keyEnd = endOfJsonString(raw, i);
            String key;
            try {
                key = (String) new JSONTokener(raw.substring(i, keyEnd)).nextValue();
            } catch (JSONException e) {
                throw new IllegalStateException(e);
            }
            i = skipWhitespace(raw, keyEnd);
            if (raw.charAt(i) != ':') {
                throw new IllegalStateException("Expected ':' after object key");
            }
            i = skipWhitespace(raw, i + 1);
            int valueEnd = endOfJsonValue(raw, i);
            String valueToken = raw.substring(i, valueEnd);
            try {
                out.put(key, elementGetAsStringFromRawToken(valueToken));
            } catch (JSONException e) {
                throw new IllegalStateException(e);
            }
            i = skipWhitespace(raw, valueEnd);
            if (i < raw.length() && raw.charAt(i) == ',') {
                i++;
            }
        }
        return out;
    }

    static List<String> splitTopLevelJsonArrayElements(String arrayJson) {
        String trimmed = arrayJson.trim();
        if (trimmed.length() < 2 || trimmed.charAt(0) != '[') {
            throw new IllegalStateException("Not a JSON array");
        }
        List<String> elements = new ArrayList<>();
        int i = skipWhitespace(trimmed, 1);
        while (true) {
            i = skipWhitespace(trimmed, i);
            if (trimmed.charAt(i) == ']') {
                break;
            }
            int end = endOfJsonValue(trimmed, i);
            elements.add(trimmed.substring(i, end));
            i = skipWhitespace(trimmed, end);
            if (trimmed.charAt(i) == ',') {
                i++;
            }
        }
        return elements;
    }

    static int endOfJsonValue(String s, int start) {
        start = skipWhitespace(s, start);
        char c = s.charAt(start);
        if (c == '"') {
            return endOfJsonString(s, start);
        }
        if (c == '{') {
            return indexOfMatchingBracket(s, start, '{', '}') + 1;
        }
        if (c == '[') {
            return indexOfMatchingBracket(s, start, '[', ']') + 1;
        }
        if (s.startsWith("null", start)) {
            return start + 4;
        }
        if (s.startsWith("true", start)) {
            return start + 4;
        }
        if (s.startsWith("false", start)) {
            return start + 5;
        }
        int i = start;
        while (i < s.length()) {
            char ch = s.charAt(i);
            if (ch == ',' || ch == ']' || ch == '}' || Character.isWhitespace(ch)) {
                break;
            }
            i++;
        }
        return i;
    }

    static int endOfJsonString(String s, int start) {
        if (s.charAt(start) != '"') {
            throw new IllegalStateException("Expected string");
        }
        boolean escape = false;
        for (int i = start + 1; i < s.length(); i++) {
            char c = s.charAt(i);
            if (escape) {
                escape = false;
                continue;
            }
            if (c == '\\') {
                escape = true;
                continue;
            }
            if (c == '"') {
                return i + 1;
            }
        }
        throw new IllegalStateException("Unterminated string");
    }

    static int indexOfMatchingBracket(String s, int openIdx, char open, char close) {
        int depth = 0;
        boolean inString = false;
        boolean escape = false;
        for (int i = openIdx; i < s.length(); i++) {
            char c = s.charAt(i);
            if (escape) {
                escape = false;
                continue;
            }
            if (inString && c == '\\') {
                escape = true;
                continue;
            }
            if (c == '"') {
                inString = !inString;
                continue;
            }
            if (inString) {
                continue;
            }
            if (c == open) {
                depth++;
            } else if (c == close) {
                depth--;
                if (depth == 0) {
                    return i;
                }
            }
        }
        throw new IllegalStateException("Unbalanced brackets");
    }

    static int skipWhitespace(String s, int index) {
        while (index < s.length() && Character.isWhitespace(s.charAt(index))) {
            index++;
        }
        return index;
    }

    static String parseQuotedStringToken(String json, int start, int end) throws JSONException {
        try {
            return (String) new JSONTokener(json.substring(start, end)).nextValue();
        } catch (JSONException e) {
            throw new JSONException("Invalid object key", e);
        }
    }

    private static void checkNumberStringLength(String s) {
        if (s.length() > MAX_NUMBER_STRING_LENGTH) {
            throw new NumberFormatException("Number string too large");
        }
    }

    private static BigDecimal parseBigDecimalLikeGson(String s) {
        checkNumberStringLength(s);
        BigDecimal decimal = new BigDecimal(s);
        if (Math.abs((long) decimal.scale()) >= 10_000) {
            throw new NumberFormatException("Number has unsupported scale");
        }
        return decimal;
    }
}
