import { useLanguage } from '@/contexts/LanguageContext';

const content = {
  en: {
    edit: 'Change email / password', description: 'Update the login details for',
    hint: 'Leave the password blank to keep it. A changed email is ready to use immediately.',
    saved: 'Login details updated', failed: 'Unable to change login details. Please try again.',
    restricted: 'Direct credential changes are disabled by your role permissions.',
  },
  fr: {
    edit: 'Modifier e-mail / mot de passe', description: 'Modifier les identifiants de',
    hint: 'Laissez le mot de passe vide pour le conserver. Le nouvel e-mail est utilisable immédiatement.',
    saved: 'Identifiants mis à jour', failed: 'Impossible de modifier les identifiants. Réessayez.',
    restricted: 'La modification directe des identifiants est désactivée pour votre rôle.',
  },
  de: {
    edit: 'E-Mail / Passwort ändern', description: 'Anmeldedaten ändern für',
    hint: 'Passwort leer lassen, um es beizubehalten. Eine neue E-Mail ist sofort nutzbar.',
    saved: 'Anmeldedaten aktualisiert', failed: 'Anmeldedaten konnten nicht geändert werden. Bitte erneut versuchen.',
    restricted: 'Direkte Änderungen der Anmeldedaten sind für Ihre Rolle deaktiviert.',
  },
  it: {
    edit: 'Modifica e-mail / password', description: 'Aggiorna le credenziali di',
    hint: 'Lascia la password vuota per mantenerla. La nuova e-mail è utilizzabile immediatamente.',
    saved: 'Credenziali aggiornate', failed: 'Impossibile modificare le credenziali. Riprova.',
    restricted: 'La modifica diretta delle credenziali è disabilitata per il tuo ruolo.',
  },
};
export const useStaffCredentialsContent = () => content[useLanguage().language];
