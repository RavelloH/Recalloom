/**
 * The form submits to /authorize on this origin. Browsers also enforce form-action
 * on the redirect chain after an OAuth 302; include the validated client callback
 * origin (from the provider-validated redirect_uri), not an arbitrary URL param.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => '&#' + ch.charCodeAt(0) + ';');
}

export function page(title: string, body: string, status = 200, allowedFormOrigin?: string): Response {
  // Only pass a callback origin obtained from a validated OAuth authorization request.
  const formAction = allowedFormOrigin ? "'self' " + new URL(allowedFormOrigin).origin : "'self'";
  return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
    + escapeHtml(title) + '</title><style>body{max-width:660px;margin:8vh auto;padding:0 20px;font:16px/1.6 system-ui;color:#202635}main{padding:28px;border:1px solid #d1d7e0;border-radius:14px}input{font:inherit;padding:10px;width:95%;margin:10px 0}button{font:inherit;padding:10px 20px;margin-right:8px;cursor:pointer}</style><main>'+body+'</main></html>',{
    status,headers:{
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action " + formAction + "; base-uri 'none'; frame-ancestors 'none'",
      'referrer-policy':'no-referrer'
    }
  });
}

export function consentForm(
  request: Request,
  clientName: string,
  redirectHost: string,
  handle: string,
  scopes: readonly string[],
  error = ''
): string {
  const url = new URL(request.url);
  const scopeInputs = scopes.map(scope => '<input type="hidden" name="scope" value="' + escapeHtml(scope) + '">').join('');
  return '<h1>授权 Recalloom</h1>'
    + (error ? '<p role="alert">' + escapeHtml(error) + '</p>' : '')
    + '<p>客户端 <strong>' + escapeHtml(clientName) + '</strong> 正在请求访问你的私人知识库。</p>'
    + '<p>回调域名：' + escapeHtml(redirectHost) + '</p>'
    + '<p>权限：' + scopes.map(escapeHtml).join(', ') + '</p>'
    + '<form method="post" action="' + escapeHtml(url.pathname + url.search) + '">'
    + '<input type="hidden" name="handle" value="' + escapeHtml(handle) + '">' + scopeInputs
    + '<label>授权密钥<input type="password" name="secret" required autocomplete="current-password"></label>'
    + '<button name="decision" value="approve">授权</button><button name="decision" value="deny" formnovalidate>拒绝</button>'
    + '</form>';
}
