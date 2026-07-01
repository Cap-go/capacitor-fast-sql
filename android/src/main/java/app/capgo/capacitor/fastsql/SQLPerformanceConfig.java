package app.capgo.capacitor.fastsql;

/**
 * Applies optional SQLite performance PRAGMAs at database open time.
 */
public final class SQLPerformanceConfig {

    private SQLPerformanceConfig() {}

    public static void apply(PerformancePragmaExecutor executor, boolean walMode, boolean performancePresets) throws Exception {
        executor.execSQL("PRAGMA foreign_keys = ON");

        if (walMode) {
            executor.execSQL("PRAGMA journal_mode = WAL");
        }

        if (performancePresets) {
            executor.execSQL("PRAGMA synchronous = NORMAL");
            executor.execSQL("PRAGMA busy_timeout = 5000");
            executor.execSQL("PRAGMA cache_size = -2000");
        }
    }

    @FunctionalInterface
    public interface PerformancePragmaExecutor {
        void execSQL(String sql) throws Exception;
    }
}
