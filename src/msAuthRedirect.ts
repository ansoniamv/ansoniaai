import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

// The Outlook sign-in popup lands here (see src/lib/outlookMail.ts). The result
// goes back to the app tab over a same-origin BroadcastChannel, which still
// works under this site's Cross-Origin-Opener-Policy, and the popup closes.
broadcastResponseToMainFrame().catch((e) => {
  document.body.textContent = `Sign-in could not finish: ${(e as Error).message}. Close this window and try again.`;
});
