/* Einstellungen für den Geräte-Abgleich über OneDrive.
 * clientId: „Anwendungs-ID (Client)“ aus der App-Registrierung im Microsoft-Entra-Portal.
 * Sie ist laut Microsoft kein Geheimnis und darf öffentlich im Code stehen (PKCE, kein Client-Secret).
 * Leer lassen = Abgleich ausgeblendet.
 */
export const ONEDRIVE = {
  clientId: "",
  authority: "https://login.microsoftonline.com/consumers", // private Microsoft-Konten (outlook.de, hotmail.de, live.de …)
  scopes: "Files.ReadWrite.AppFolder offline_access",
};
