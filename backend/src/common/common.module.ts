import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IdempotencyKeyGuard } from './guards/idempotency-key.guard';
import { AffiliateGuard } from './guards/affiliate.guard';
import { OAuth2Guard } from './guards/oauth2.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'dev-secret-change-me',
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') || '1d' },
      }),
    }),
  ],
  providers: [IdempotencyKeyGuard, AffiliateGuard, OAuth2Guard],
  exports: [IdempotencyKeyGuard, AffiliateGuard, OAuth2Guard, JwtModule],
})
export class CommonModule {}
