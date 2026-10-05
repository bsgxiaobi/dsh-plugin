/**
 * `dsh-plugin-send-to-chat` — node half.
 *
 * Pure browser plugin: every behavior lives in the client bundle served from
 * `exports["./client"]`, which the host discovers through this package's
 * `dsh.client` declaration. The empty `apply` exists only so the package can be
 * mounted as a Loader entry like any other plugin.
 */

/** Host plugin body — no host-side behavior for this browser-only surface. */
function apply() {}

export { apply };
