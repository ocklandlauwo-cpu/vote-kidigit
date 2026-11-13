import { Controller, Get, Module, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SearchQuerySchema, type SearchResults } from '@vote-kidigit/shared';
import { AuthModule } from '../../auth/auth.module.js';
import type { AuthState } from '../../auth/auth.types.js';
import { CurrentAuth, SignedIn } from '../../auth/decorators.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { SearchService } from './search.service.js';

class SearchQueryDto extends zodDto(SearchQuerySchema) {}

/** Global search of the top bar (App Flow 3.6). */
@Controller('v1/search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** GET /api/v1/search?q= — typing sends a request per pause, hence its own limit. */
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @SignedIn()
  search(@CurrentAuth() auth: AuthState, @Query() query: SearchQueryDto): Promise<SearchResults> {
    return this.searchService.search(auth, query.q);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
