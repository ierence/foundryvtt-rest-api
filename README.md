### How to use Foundry REST API:

- Install the Founndry VTT module using the latest manifest link: [https://github.com/ThreeHats/foundryvtt-rest-api/releases/latest/download/module.json](https://github.com/ThreeHats/foundryvtt-rest-api/releases/latest/download/module.json)
    
- Get an API key for the public relay server at [https://foundryvtt-rest-api-relay.fly.dev/](https://foundryvtt-rest-api-relay.fly.dev/)
    
- Download [Postman](https://www.postman.com/downloads/) and the import the latest [API Test Collection](https://github.com/ThreeHats/foundryvtt-rest-api-relay/blob/main/Foundry%20REST%20API%20Documentation.postman_collection.json) for an easy way to start testing endpoints.
    
- Read the [documentation](https://github.com/ThreeHats/foundryvtt-rest-api-relay/wiki) for information about how to use each endpoint

- Join the [discord](https://discord.gg/U634xNGRAC) server for updates, questions, and discussions
    

---

Foundry REST API provides various API endpoints for fetching and interacting with your foundry world data through a node.js server that act as a relay.

## **Getting started guide**

To start using the Foundry REST API, you need to -
    
- Have your API key in the module settings.
    
- Each request must have the your API key in the "x-api-key" header.
    
- Endpoints other than /clients require a clientId parameter that matches a connected world.
