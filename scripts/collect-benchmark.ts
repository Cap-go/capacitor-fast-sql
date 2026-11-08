/** Local-only collector for emulator/simulator benchmark reports. */
const destination = process.argv[2];
if (!destination) throw new Error('Usage: bun scripts/collect-benchmark.ts <report.json>');
const collector = Bun.serve({
  hostname: '127.0.0.1',
  port: 9876,
  maxRequestBodySize: 8 * 1024 * 1024,
  async fetch(request) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/report')
      return new Response(null, { status: 404 });
    try {
      const report: unknown = await request.json();
      if (!report || typeof report !== 'object' || !('schemaVersion' in report))
        return new Response(null, { status: 400, headers });
      await Bun.write(destination, JSON.stringify(report, null, 2));
      console.info(`Benchmark report saved to ${destination}`);
      clearTimeout(deadline);
      setTimeout(() => collector.stop(), 1000);
      return new Response('Saved', { headers });
    } catch {
      return new Response(null, { status: 400, headers });
    }
  },
});
const deadline = setTimeout(() => {
  collector.stop(true);
  process.exitCode = 1;
}, 600000);
console.info('Local benchmark collector listening on http://127.0.0.1:9876/report');
