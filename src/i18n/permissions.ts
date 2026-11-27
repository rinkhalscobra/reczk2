import { useLanguage } from '@/contexts/LanguageContext';

const copy = {
  en: {
    title: 'Permissions', description: 'Choose how each role resets passwords. Access stays limited to their assigned users.',
    group_admin: 'Group Admin', supervisor: 'Supervisor', agent: 'Agent', password: 'Reset passwords',
    direct: 'Allow directly', approval: 'Require approval', deny: 'Deny', fixed: 'Superior Admin always has full access.',
    save: 'Save permissions', saved: 'Permissions saved', reload: 'Reload saved permissions',
    error: 'Unable to load permissions', retry: 'Retry', denied: 'Password reset disabled', checking: 'Checking permissions…',
    waiting: 'Awaiting approval', requests: 'Password requests', processing: 'Processing',
    requestNote: 'A higher-level manager must approve this request before the password is changed.',
  },
  fr: {
    title: 'Autorisations', description: 'Choisissez comment chaque rôle réinitialise les mots de passe, uniquement pour ses utilisateurs attribués.',
    group_admin: 'Administrateur de groupe', supervisor: 'Superviseur', agent: 'Agent', password: 'Réinitialiser les mots de passe',
    direct: 'Autoriser directement', approval: 'Exiger une approbation', deny: 'Refuser', fixed: "L’administrateur supérieur conserve tous les accès.",
    save: 'Enregistrer les autorisations', saved: 'Autorisations enregistrées', reload: 'Recharger les autorisations enregistrées',
    error: 'Impossible de charger les autorisations', retry: 'Réessayer', denied: 'Réinitialisation désactivée', checking: 'Vérification des autorisations…',
    waiting: 'En attente d’approbation', requests: 'Demandes de mot de passe', processing: 'Traitement en cours',
    requestNote: 'Un responsable de niveau supérieur doit approuver cette demande avant la modification du mot de passe.',
  },
  de: {
    title: 'Berechtigungen', description: 'Legen Sie fest, wie jede Rolle Passwörter zurücksetzt. Der Zugriff bleibt auf zugewiesene Benutzer beschränkt.',
    group_admin: 'Gruppenadmin', supervisor: 'Supervisor', agent: 'Agent', password: 'Passwörter zurücksetzen',
    direct: 'Direkt erlauben', approval: 'Genehmigung erforderlich', deny: 'Verweigern', fixed: 'Der übergeordnete Admin behält vollen Zugriff.',
    save: 'Berechtigungen speichern', saved: 'Berechtigungen gespeichert', reload: 'Gespeicherte Berechtigungen neu laden',
    error: 'Berechtigungen konnten nicht geladen werden', retry: 'Erneut versuchen', denied: 'Passwortänderung deaktiviert', checking: 'Berechtigungen werden geprüft…',
    waiting: 'Genehmigung ausstehend', requests: 'Passwortanfragen', processing: 'Wird verarbeitet',
    requestNote: 'Eine übergeordnete Führungskraft muss diese Anfrage vor der Passwortänderung genehmigen.',
  },
  it: {
    title: 'Permessi', description: 'Scegli come ogni ruolo reimposta le password. L’accesso resta limitato agli utenti assegnati.',
    group_admin: 'Amministratore di gruppo', supervisor: 'Supervisore', agent: 'Agente', password: 'Reimpostare le password',
    direct: 'Consenti direttamente', approval: 'Richiedi approvazione', deny: 'Nega', fixed: 'L’amministratore superiore mantiene l’accesso completo.',
    save: 'Salva permessi', saved: 'Permessi salvati', reload: 'Ricarica i permessi salvati',
    error: 'Impossibile caricare i permessi', retry: 'Riprova', denied: 'Reimpostazione disabilitata', checking: 'Verifica dei permessi…',
    waiting: 'In attesa di approvazione', requests: 'Richieste password', processing: 'Elaborazione in corso',
    requestNote: 'Un responsabile di livello superiore deve approvare la richiesta prima della modifica della password.',
  },
};

export const usePermissionsContent = () => copy[useLanguage().language];
