# Consumer ProGuard rules for @capgo/capacitor-fast-sql (merged into app R8 when this AAR is a dependency).

# CapgoCapacitorFastSqlPlugin uses Class.forName on this class when encrypted databases are enabled.
# R8 must keep the type so the optional SQLCipher dependency still resolves at runtime.
-keep class net.zetetic.database.sqlcipher.SQLiteDatabase { *; }

# SQLCipher is compileOnly and also exposes types such as DatabaseErrorHandler
# directly under net.zetetic.database. Plain-SQLite apps omit the entire artifact.
-dontwarn net.zetetic.database.**

# EncryptedSQLDatabase loads the SQLCipher JNI library by name; keep JNI method names linked from Java.
-keepclasseswithmembernames class * {
    native <methods>;
}
