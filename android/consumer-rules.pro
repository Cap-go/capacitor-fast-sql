# Consumer ProGuard rules for @capgo/capacitor-fast-sql (merged into app R8 when this AAR is a dependency).

# CapgoCapacitorFastSqlPlugin uses Class.forName on this class when encrypted databases are enabled.
# R8 must keep the type so the optional SQLCipher dependency still resolves at runtime.
-keep class net.zetetic.database.sqlcipher.SQLiteDatabase { *; }

# EncryptedSQLDatabase loads the SQLCipher JNI library by name; keep JNI method names linked from Java.
-keepclasseswithmembernames class * {
    native <methods>;
}
