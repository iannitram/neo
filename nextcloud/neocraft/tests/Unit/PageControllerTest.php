<?php

declare(strict_types=1);

namespace OCA\NeoCraft\Tests\Unit;

use OCA\NeoCraft\Controller\PageController;
use OCP\AppFramework\Http\TemplateResponse;
use PHPUnit\Framework\TestCase;

class PageControllerTest extends TestCase {
	public function testIndexRendersTheEmptyMainTemplate(): void {
		// no constructor: the test does not depend on how the controller takes its request
		$controller = (new \ReflectionClass(PageController::class))->newInstanceWithoutConstructor();

		$response = $controller->index();

		$this->assertInstanceOf(TemplateResponse::class, $response);
		$this->assertSame('main', $response->getTemplateName());
		$this->assertSame('neocraft', $response->getApp());
	}
}
