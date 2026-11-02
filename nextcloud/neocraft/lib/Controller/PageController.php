<?php

declare(strict_types=1);

namespace OCA\NeoCraft\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;

#[NoAdminRequired]
#[NoCSRFRequired]
class PageController extends Controller {
	public function index(): TemplateResponse {
		return new TemplateResponse('neocraft', 'main');
	}
}