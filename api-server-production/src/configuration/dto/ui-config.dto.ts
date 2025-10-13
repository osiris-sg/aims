import { IsString, IsObject, IsOptional, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUIConfigDto {
  @ApiProperty({
    description: 'Theme configuration',
    example: { primaryColor: '#1976d2', secondaryColor: '#dc004e', mode: 'light' },
    required: false
  })
  @IsObject()
  @IsOptional()
  theme?: {
    primaryColor?: string;
    secondaryColor?: string;
    mode?: 'light' | 'dark';
    fontSize?: 'small' | 'medium' | 'large';
    borderRadius?: number;
  };

  @ApiProperty({
    description: 'Custom navigation configuration',
    required: false
  })
  @IsObject()
  @IsOptional()
  navigationConfig?: Record<string, any>;

  @ApiProperty({
    description: 'Dashboard widget layout configuration',
    required: false
  })
  @IsObject()
  @IsOptional()
  dashboardLayout?: {
    widgets: Array<{
      id: string;
      type: string;
      position: { x: number; y: number; w: number; h: number };
      config?: Record<string, any>;
    }>;
  };

  @ApiProperty({
    description: 'Custom terminology for entities',
    example: { asset: 'Equipment', customer: 'Client' },
    required: false
  })
  @IsObject()
  @IsOptional()
  terminology?: Record<string, string>;

  @ApiProperty({
    description: 'Date format',
    example: 'MM/dd/yyyy',
    required: false
  })
  @IsString()
  @IsOptional()
  @IsIn(['MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd'])
  dateFormat?: string;

  @ApiProperty({
    description: 'Time format',
    example: '12h',
    required: false
  })
  @IsString()
  @IsOptional()
  @IsIn(['12h', '24h'])
  timeFormat?: string;

  @ApiProperty({
    description: 'Currency code',
    example: 'USD',
    required: false
  })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({
    description: 'Language code',
    example: 'en',
    required: false
  })
  @IsString()
  @IsOptional()
  @IsIn(['en', 'es', 'fr', 'de', 'pt', 'zh', 'ja', 'ko'])
  language?: string;

  @ApiProperty({
    description: 'Feature flags',
    example: { enableProjects: true, enableDocumentAI: false },
    required: false
  })
  @IsObject()
  @IsOptional()
  features?: Record<string, boolean>;

  @ApiProperty({
    description: 'Additional branding configuration',
    required: false
  })
  @IsObject()
  @IsOptional()
  branding?: {
    logoPosition?: 'left' | 'center' | 'right';
    showOrganizationName?: boolean;
    customCSS?: string;
    favicon?: string;
  };
}

export class ThemeDto {
  @ApiProperty({ description: 'Primary color hex code' })
  primaryColor: string;

  @ApiProperty({ description: 'Secondary color hex code' })
  secondaryColor: string;

  @ApiProperty({ description: 'Theme mode', enum: ['light', 'dark'] })
  mode: 'light' | 'dark';

  @ApiProperty({ description: 'Font size preference', enum: ['small', 'medium', 'large'], required: false })
  fontSize?: 'small' | 'medium' | 'large';

  @ApiProperty({ description: 'Border radius in pixels', required: false })
  borderRadius?: number;
}

export class TerminologyDto {
  @ApiProperty({ description: 'Custom term for assets' })
  asset?: string;

  @ApiProperty({ description: 'Custom term for inventory' })
  inventory?: string;

  @ApiProperty({ description: 'Custom term for customers' })
  customer?: string;

  @ApiProperty({ description: 'Custom term for documents' })
  document?: string;

  @ApiProperty({ description: 'Custom term for projects' })
  project?: string;

  @ApiProperty({ description: 'Custom term for invoices' })
  invoice?: string;

  [key: string]: string | undefined;
}