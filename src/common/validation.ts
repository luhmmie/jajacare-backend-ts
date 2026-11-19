/** Nigerian mobile numbers: 0803..., 07012..., or +234803... */
export const NG_PHONE = /^(\+234|0)[789][01]\d{8}$/;
export const NG_PHONE_MESSAGE = 'Enter a valid Nigerian phone number';

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const trimUpper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
