import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTradeSettingsDto {
  @IsOptional() @IsString() @MaxLength(2000) defaultConsignee?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) defaultNotifyParty?: string | null;
  /** Document texts to change (TradeSetting.docDefaults): listed keys are replaced, null removes one. Checked in the service. */
  @IsOptional() @IsObject() docDefaults?: Record<string, unknown>;
}
