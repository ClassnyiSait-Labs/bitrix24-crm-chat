# CRM чаты для Bitrix24

[English version](README.md) · [Лицензия MIT](LICENSE)

[![CI](https://github.com/ClassnyiSait-Labs/bitrix24-crm-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/ClassnyiSait-Labs/bitrix24-crm-chat/actions/workflows/ci.yml) [![Latest release](https://img.shields.io/github/v/release/ClassnyiSait-Labs/bitrix24-crm-chat?label=release)](https://github.com/ClassnyiSait-Labs/bitrix24-crm-chat/releases/latest) [![PHP](https://img.shields.io/badge/PHP-8.1%2B-777bb4)](https://www.php.net/) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)


Бесплатный модуль с открытым исходным кодом для **коробочного Bitrix24**. Добавляет в мессенджер
отдельную вкладку **«CRM чаты»** — быстрый доступ к чатам сделок и контактов вместо поиска их в
общем списке Recent.

## Видео

[CRM чаты в Битрикс24: отдельная вкладка для деловых переписок](https://www.youtube.com/watch?v=YkQRzdeVEKY)

Канал: https://www.youtube.com/@ClassnyiSaitLabs


![Вкладка CRM чатов](docs/screenshots/01-overview.png)

## Зачем

В портале с активными продажами чаты по сделкам и внутренние командные чаты лежат в одном плоском
списке. Менеджер прокручивает рабочий шум, чтобы найти переписку с клиентом. Модуль разделяет их:
CRM-переписки получают собственную вкладку в навигации мессенджера.

## Возможности

- отдельная вкладка «CRM чаты» в навигации мессенджера;
- фильтрация чатов по типу CRM-сущности;
- штатное поведение мессенджера не меняется — вкладка только добавляется;
- поддержка коробочного Bitrix24 (интерфейс v26).

## Требования

- коробочная редакция Bitrix24, версия 26.0 и выше
- веб-версия мессенджера

## Установка

1. Скопируйте папку `classnyisait.crmchat` в `/local/modules/` (или `/bitrix/modules/`).
2. **Marketplace → Установленные решения** → «CRM чаты» → *Установить*.
3. Перезагрузите мессенджер — вкладка «CRM чаты» появится в навигации.

Страница модуля: <https://classnyisait.ru/modules/>

## Скриншоты

![Вкладка CRM чатов в мессенджере](docs/screenshots/02-tab.jpg)

## Структура проекта

```
classnyisait.crmchat/
├── install/js/         интеграция в навигацию мессенджера и фильтр CRM-чатов
├── lib/CrmChat.php     логика выборки CRM-чатов
├── lib/EventHandler.php, lib/EventRegistrar.php  подписка на события
└── test/               PHP-тесты
```

## Разработка

```bash
composer install
composer test          # 28 PHPUnit-тестов
```

Тесты покрывают чистую логику, работающую без ядра Битрикса. Всё, что обращается к базе,
корзине или интерфейсу мессенджера, требует живого портала и проверяется вручную —
подробности в [CONTRIBUTING.md](CONTRIBUTING.md).

CI прогоняет линт и тесты на PHP 8.1, 8.2 и 8.3 при каждом push и pull request.

## Вклад в проект

Issues и pull requests приветствуются. При баг-репорте укажите номер сборки Bitrix24.

## Лицензия

MIT — см. [LICENSE](LICENSE).

Разработчик: [ClassnyiSait Labs](https://classnyisait.ru/) ·
[Поддержать разработчика](https://classnyisait.ru/support)
