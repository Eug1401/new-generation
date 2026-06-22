declare module 'npm:jszip@3.10.1' {
  const JSZip: any;
  export default JSZip;
}
declare namespace Deno {
  namespace env { function get(name: string): string | undefined; }
  function serve(handler: (request: Request) => Response | Promise<Response>): void;
}
