# Content-Security-Policy (PRODUCT-SPEC §6.1, PV-1)

The policy ships as a `<meta http-equiv="Content-Security-Policy">` in `app/index.html`:

    default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:;
    img-src 'self' blob: data:; media-src 'self' blob: mediastream:; style-src 'self'; font-src 'self';
    object-src 'none'; base-uri 'none'; form-action 'none'

`frame-ancestors 'none'` belongs to the policy too, but browsers ignore it in a meta element (Chrome logs a console
error for it), so it is left out of the meta. GitHub Pages cannot send response headers. A host that can should send
the full policy, `frame-ancestors 'none'` included, as a `Content-Security-Policy` header.

Consequences for app code: no inline scripts or `style="…"` attributes (use classes, or CSSOM `el.style.x = …`); no
eval / `new Function`; no request leaves the origin (`connect-src 'self'`, the second layer behind the landmarker's
fetch guard). The e2e gate `a-shell` checks for 0 violations and that a cross-origin fetch probe is blocked.
