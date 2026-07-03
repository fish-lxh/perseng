# Perseng Docker

Quick deployment of Perseng MCP Server using Docker.

## Quick Start

### Using Docker Hub Image (Recommended)
```bash
# Pull and run from Docker Hub
docker run -d \
  -p 5203:5203 \
  -v $(pwd)/.perseng:/root/.perseng \
  --name perseng \
  deepracticexs/perseng:latest
```

### Using Docker Compose
```bash
cd docker
docker-compose up -d
```

### Build from Source
```bash
# Build image locally
docker build -t deepracticexs/perseng -f docker/Dockerfile .

# Run container
docker run -d \
  -p 5203:5203 \
  -v $(pwd)/.perseng:/root/.perseng \
  --name perseng \
  deepracticexs/perseng
```

## Configuration

The MCP server runs in HTTP mode by default on port 5203 with CORS enabled.

### Claude Desktop Configuration
```json
{
  "mcpServers": {
    "promptx": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:5203/mcp"
    }
  }
}
```

## Data Persistence

Perseng data is stored in `./.perseng` directory next to `docker-compose.yml` by default.
This includes:
- User roles
- Memory data
- Configuration files

You can customize the data location using the `PERSENG_DATA` environment variable:
```bash
# Use custom data directory
PERSENG_DATA=/path/to/data docker-compose up -d

# Or export it
export PERSENG_DATA=/home/user/.perseng
docker-compose up -d
```

## Environment Variables

- `PERSENG_DATA`: Custom data directory path (default: `./.perseng`)
- `NODE_ENV`: Set to `production` by default
- Port: 5203 (exposed)

## Notes

- The container runs as root user
- Data is persisted in local `.perseng` folder
- CORS is enabled for web access
