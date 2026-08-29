/**
 * The Google Picker stays client-side by design: under the drive.file
 * scope, the act of picking a file in the picker is what grants the app
 * access to it — that grant must happen in the user's browser. The server
 * hands over a short-lived access token just for the picker session.
 */

import { api } from './api.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

/** Open the picker on the user's spreadsheets; resolves with the picked
 *  spreadsheet ID, or null if cancelled. */
export async function pickSpreadsheet() {
  const cfg = await api('/api/picker-config');
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve) => gapi.load('picker', resolve));
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(false);
    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(cfg.accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      // tell the picker iframe its embedding origin explicitly, so key
      // validation doesn't depend on what the Referer header carries
      .setOrigin(location.protocol + '//' + location.host)
      .addView(view)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          resolve(data.docs[0].id);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
