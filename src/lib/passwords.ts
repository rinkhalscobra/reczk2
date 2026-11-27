export const generateSecurePassword = (): string => {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghjkmnpqrstuvwxyz', '23456789', '!@#$%&*'];
  const random = new Uint32Array(32);
  crypto.getRandomValues(random);
  const characters = groups.join('');
  const password = groups.map((group, i) => group[random[i] % group.length]);
  for (let i = password.length; i < 16; i++) password.push(characters[random[i] % characters.length]);
  for (let i = password.length - 1; i > 0; i--) {
    const j = random[16 + i] % (i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }
  return password.join('');
};

