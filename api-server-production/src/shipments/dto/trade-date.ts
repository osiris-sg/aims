import { registerDecorator, ValidationOptions } from 'class-validator';
import { tradeDateError } from '../shipments.rules';

/**
 * A trade date / month: blank, or "YYYY-MM-DD" / "YYYY-MM" / ISO timestamp
 * with a 4-digit year in 2000–2100 (see tradeDateError).
 */
export function IsTradeDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isTradeDate',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => tradeDateError(value, propertyName) === null,
        defaultMessage: (args) => tradeDateError(args?.value, args?.property ?? propertyName) ?? `${propertyName} must be a date`,
      },
    });
}
