import { useLanguage } from '@/contexts/LanguageContext';

const content = {
  en: { change: 'Change case number', changeFor: 'Change case number for',
    hint: 'Entering an active agent’s case number transfers this client to that agent within your permissions. The client signs in with the saved case number and their existing email and password.',
    invalid: 'Enter 1 to 100 characters without control characters.', saved: 'Case number updated.', unconfirmed: 'The case number change could not be confirmed.' },
  fr: { change: 'Modifier le numéro de dossier', changeFor: 'Modifier le numéro de dossier de',
    hint: 'Saisir le numéro de dossier d’un agent actif transfère ce client à cet agent selon vos autorisations. Le client se connecte avec le numéro enregistré, son email et son mot de passe actuels.',
    invalid: 'Saisissez de 1 à 100 caractères sans caractères de contrôle.', saved: 'Numéro de dossier mis à jour.', unconfirmed: 'La modification du numéro de dossier n’a pas pu être confirmée.' },
  de: { change: 'Fallnummer ändern', changeFor: 'Fallnummer ändern für',
    hint: 'Die Fallnummer eines aktiven Agenten überträgt diesen Kunden im Rahmen Ihrer Berechtigungen an diesen Agenten. Der Kunde meldet sich mit der gespeicherten Fallnummer sowie seiner bisherigen E-Mail und seinem Passwort an.',
    invalid: 'Geben Sie 1 bis 100 Zeichen ohne Steuerzeichen ein.', saved: 'Fallnummer aktualisiert.', unconfirmed: 'Die Änderung der Fallnummer konnte nicht bestätigt werden.' },
  it: { change: 'Modifica numero pratica', changeFor: 'Modifica numero pratica di',
    hint: 'Inserendo il numero pratica di un agente attivo, il cliente viene trasferito a tale agente secondo le tue autorizzazioni. Il cliente accede con il numero salvato e la sua email e password attuali.',
    invalid: 'Inserisci da 1 a 100 caratteri senza caratteri di controllo.', saved: 'Numero pratica aggiornato.', unconfirmed: 'Impossibile confermare la modifica del numero pratica.' },
};

export const useClientCaseNumberContent = () => content[useLanguage().language];
