import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type Category,
  type CategoryListResponse,
  ChangeEligibilityRequestSchema,
  type Contester,
  CreateCategoryRequestSchema,
  CreateContesterRequestSchema,
  type EligibilityResponse,
  PHOTO_ZIP_MAX_BYTES,
  PhotoZipRequestSchema,
  type PhotoZipResult,
  ReorderCategoriesRequestSchema,
  SetEligibilityRequestSchema,
  UpdateCategoryRequestSchema,
  UpdateContesterRequestSchema,
  UPLOAD_FIELD,
} from '@vote-kidigit/shared';
import type { AuthState } from '../../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import type { Upload } from '../files/files.service.js';
import { CategoriesService } from './categories.service.js';
import { ContestersService } from './contesters.service.js';

class CreateCategoryBody extends zodDto(CreateCategoryRequestSchema) {}
class UpdateCategoryBody extends zodDto(UpdateCategoryRequestSchema) {}
class ReorderBody extends zodDto(ReorderCategoriesRequestSchema) {}
class SetEligibilityBody extends zodDto(SetEligibilityRequestSchema) {}
class ChangeEligibilityBody extends zodDto(ChangeEligibilityRequestSchema) {}
class CreateContesterBody extends zodDto(CreateContesterRequestSchema) {}
class UpdateContesterBody extends zodDto(UpdateContesterRequestSchema) {}
class PhotoZipBody extends zodDto(PhotoZipRequestSchema) {}

const EventId = () => Param('eventId', IdParamPipe);
const CategoryId = () => Param('categoryId', IdParamPipe);
const ContesterId = () => Param('contesterId', IdParamPipe);

/** Categories and contesters of an event (Backend Schema 12.6, EVT-04). */
@Controller('v1/events/:eventId')
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly contesters: ContestersService,
  ) {}

  /** GET /api/v1/events/:eventId/categories */
  @Get('categories')
  @RequirePermission('event.view')
  list(@EventId() eventId: string): Promise<CategoryListResponse> {
    return this.categories.list(eventId);
  }

  /** POST /api/v1/events/:eventId/categories */
  @Post('categories')
  @RequirePermission('category.manage')
  create(@EventId() eventId: string, @Body() body: CreateCategoryBody): Promise<Category> {
    return this.categories.create(eventId, body);
  }

  /** PUT /api/v1/events/:eventId/categories/order */
  @Put('categories/order')
  @RequirePermission('category.manage')
  reorder(@EventId() eventId: string, @Body() body: ReorderBody): Promise<CategoryListResponse> {
    return this.categories.reorder(eventId, body);
  }

  /** PATCH /api/v1/events/:eventId/categories/:categoryId */
  @Patch('categories/:categoryId')
  @RequirePermission('category.manage')
  update(
    @EventId() eventId: string,
    @CategoryId() categoryId: string,
    @Body() body: UpdateCategoryBody,
  ): Promise<Category> {
    return this.categories.update(eventId, categoryId, body);
  }

  /** DELETE /api/v1/events/:eventId/categories/:categoryId */
  @Delete('categories/:categoryId')
  @HttpCode(204)
  @RequirePermission('category.manage')
  remove(@EventId() eventId: string, @CategoryId() categoryId: string): Promise<void> {
    return this.categories.remove(eventId, categoryId);
  }

  /** PUT /api/v1/events/:eventId/categories/:categoryId/eligibility */
  @Put('categories/:categoryId/eligibility')
  @RequirePermission('category.manage')
  setEligibility(
    @EventId() eventId: string,
    @CategoryId() categoryId: string,
    @Body() body: SetEligibilityBody,
  ): Promise<EligibilityResponse> {
    return this.categories.setEligibility(eventId, categoryId, body);
  }

  /** PATCH /api/v1/events/:eventId/categories/:categoryId/eligibility */
  @Patch('categories/:categoryId/eligibility')
  @RequirePermission('category.manage')
  changeEligibility(
    @EventId() eventId: string,
    @CategoryId() categoryId: string,
    @Body() body: ChangeEligibilityBody,
  ): Promise<EligibilityResponse> {
    return this.categories.changeEligibility(eventId, categoryId, body);
  }

  /** POST /api/v1/events/:eventId/categories/:categoryId/open */
  @Post('categories/:categoryId/open')
  @HttpCode(200)
  @RequirePermission('event.close')
  open(@EventId() eventId: string, @CategoryId() categoryId: string): Promise<Category> {
    return this.categories.setOpen(eventId, categoryId, true);
  }

  /** POST /api/v1/events/:eventId/categories/:categoryId/close */
  @Post('categories/:categoryId/close')
  @HttpCode(200)
  @RequirePermission('event.close')
  close(@EventId() eventId: string, @CategoryId() categoryId: string): Promise<Category> {
    return this.categories.setOpen(eventId, categoryId, false);
  }

  /** POST /api/v1/events/:eventId/categories/:categoryId/picture — multipart field "file". */
  @Post('categories/:categoryId/picture')
  @HttpCode(200)
  @RequirePermission('category.manage')
  @UseInterceptors(FileInterceptor(UPLOAD_FIELD))
  uploadPicture(
    @EventId() eventId: string,
    @CategoryId() categoryId: string,
    @UploadedFile() file: Upload | undefined,
  ): Promise<Category> {
    return this.categories.uploadPicture(eventId, categoryId, file);
  }

  /** DELETE /api/v1/events/:eventId/categories/:categoryId/picture */
  @Delete('categories/:categoryId/picture')
  @RequirePermission('category.manage')
  removePicture(@EventId() eventId: string, @CategoryId() categoryId: string): Promise<Category> {
    return this.categories.removePicture(eventId, categoryId);
  }

  /** GET /api/v1/events/:eventId/categories/:categoryId/contesters */
  @Get('categories/:categoryId/contesters')
  @RequirePermission('event.view')
  listContesters(
    @EventId() eventId: string,
    @CategoryId() categoryId: string,
  ): Promise<{ items: Contester[] }> {
    return this.contesters.list(eventId, categoryId);
  }

  /** POST /api/v1/events/:eventId/categories/:categoryId/contesters */
  @Post('categories/:categoryId/contesters')
  @RequirePermission('contester.manage')
  createContester(
    @EventId() eventId: string,
    @CategoryId() categoryId: string,
    @Body() body: CreateContesterBody,
  ): Promise<Contester> {
    return this.contesters.create(eventId, categoryId, body);
  }

  /** PATCH /api/v1/events/:eventId/contesters/:contesterId */
  @Patch('contesters/:contesterId')
  @RequirePermission('contester.manage')
  updateContester(
    @EventId() eventId: string,
    @ContesterId() contesterId: string,
    @Body() body: UpdateContesterBody,
  ): Promise<Contester> {
    return this.contesters.update(eventId, contesterId, body);
  }

  /** DELETE /api/v1/events/:eventId/contesters/:contesterId */
  @Delete('contesters/:contesterId')
  @HttpCode(204)
  @RequirePermission('contester.manage')
  removeContester(@EventId() eventId: string, @ContesterId() contesterId: string): Promise<void> {
    return this.contesters.remove(eventId, contesterId);
  }

  /** POST /api/v1/events/:eventId/contesters/:contesterId/withdraw */
  @Post('contesters/:contesterId/withdraw')
  @HttpCode(200)
  @RequirePermission('contester.manage')
  withdraw(@EventId() eventId: string, @ContesterId() contesterId: string): Promise<Contester> {
    return this.contesters.withdraw(eventId, contesterId);
  }

  /** POST /api/v1/events/:eventId/contesters/:contesterId/photo — multipart field "file". */
  @Post('contesters/:contesterId/photo')
  @HttpCode(200)
  @RequirePermission('contester.manage')
  @UseInterceptors(FileInterceptor(UPLOAD_FIELD))
  uploadPhoto(
    @EventId() eventId: string,
    @ContesterId() contesterId: string,
    @UploadedFile() file: Upload | undefined,
  ): Promise<Contester> {
    return this.contesters.uploadPhoto(eventId, contesterId, file);
  }

  /** DELETE /api/v1/events/:eventId/contesters/:contesterId/photo */
  @Delete('contesters/:contesterId/photo')
  @RequirePermission('contester.manage')
  removePhoto(@EventId() eventId: string, @ContesterId() contesterId: string): Promise<Contester> {
    return this.contesters.removePhoto(eventId, contesterId);
  }

  /**
   * POST /api/v1/events/:eventId/photos/zip — multipart "file" (ZIP up to 50 MB) and "target".
   * Backend Schema 12.6 allows contester.manage or voter.manage depending on the target, which
   * one decorator cannot say: event.view admits the user to the event and the service checks
   * the target's permission (voters arrive in step 19).
   */
  @Post('photos/zip')
  @HttpCode(200)
  @RequirePermission('event.view')
  @UseInterceptors(
    FileInterceptor(UPLOAD_FIELD, {
      limits: { fileSize: PHOTO_ZIP_MAX_BYTES, files: 1, fields: 5 },
    }),
  )
  uploadZip(
    @CurrentAuth() auth: AuthState,
    @EventId() eventId: string,
    @Body() _body: PhotoZipBody,
    @UploadedFile() file: Upload | undefined,
  ): Promise<PhotoZipResult> {
    return this.contesters.uploadZip(auth, eventId, file);
  }
}
