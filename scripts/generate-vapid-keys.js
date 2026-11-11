import webpush from 'web-push';
const keys=webpush.generateVAPIDKeys();
console.log('Ajoute ces valeurs dans ton fichier .env (ne les publie jamais) :\n');
console.log('VAPID_PUBLIC_KEY='+keys.publicKey);
console.log('VAPID_PRIVATE_KEY='+keys.privateKey);
console.log('VAPID_SUBJECT=mailto:contact@groupeexpress.ci');
