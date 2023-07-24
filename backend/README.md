# NadeDB Backend

## Setup

### Node

* Clone the repository
* Run `docker-compose up` to start the PostgreDB database
* Run `npm install`
* Create a new `.env` file from `.env.example` and set the required values
* Run:
    * `npm run dev` for a hot-reloading development version.
    * `npm run build && npm run start` to compile the Typescript code and run the
        application from the generated `prod/` folder
* The application will be available in `localhost:5000`

### Docker

* Clone the repository
* Run `docker-compose up` to start the PostgreDB database
* Run `docker build -t nadedb-backend .` to build a new image. This command has to be
    executed every time a code change is made.
* Run `docker run --rm -p 5000:5000 --network host -v ./media:/app/media --name nadedb-backend nadedb-backend`
* The application will be available in `localhost:5000`

