# FoundryVTT Module Template w/ Typescript

This repo is meant to be used as a starting point for creating your own FoundryVTT module with [Typescript][2]. If you are using Github you can get started by clicking the green `Use this template` button in the upper-right.

Check out [our blog post][4] for a walkthrough of the codebase.

## What's in the box

Out of the box this template adds a button to the top of the Actors directory. Clicking it brings up a modal with a button that will load a picture of a random dog from the [Dog API][3]. This demonstrates how to perform some common tasks such as render templates and call external APIs, and hopefully provides a decent starting point for developing your own module.

## Getting Started

```
pnpm install
pnpm dev
```

Built files will be put in the local foundry install location (AppData\Local\FoundryVTT\Data\modules).
After saving changes, refresh or close and open foundry to see effects.

[1]: https://foundryvtt.com/
[2]: https://www.typescriptlang.org/
[3]: https://dog.ceo/dog-api/
[4]: https://bringingfire.com/blog/intro-to-foundry-module-development
