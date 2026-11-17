/* Einstellungen dieser Installation – echte App „Hochsitze“ (Repo Hochsitze).
   api: Adresse des Konten-Servers (Cloudflare Worker „jagd“). */
self.JAGD_CFG = {
  app: 'hochsitze',
  api: 'https://jagd.sebastian-bruns.workers.dev',
  push: true,
  owner: 'Grunzelthuine',
  repo: 'Hochsitze',
  // nurKonto: true,  // später einschalten: nur noch Anmeldung mit Konto (kein Passwort-Feld, kein Token)
};
