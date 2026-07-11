// Fixture: NestJS-style class using experimentalDecorators syntax.
// Line numbers matter to the tests — update extractor.test.ts if you edit.
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      db: process.env.DATABASE_URL,
      key: process.env['HEALTH_KEY'],
    };
  }

  @Injectable()
  private readonly timeout = Number(process.env.HEALTH_TIMEOUT_MS);
}

declare function Controller(prefix: string): ClassDecorator;
declare function Get(): MethodDecorator;
declare function Injectable(): PropertyDecorator;
