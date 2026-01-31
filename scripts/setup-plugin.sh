#!/bin/bash

# Obsidian Plugin Setup Script
# This script initializes a new Obsidian plugin project

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔮 Obsidian Plugin Setup Script${NC}"
echo ""

# Check prerequisites
check_prerequisites() {
    echo "Checking prerequisites..."
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js is not installed${NC}"
        echo "Please install Node.js 16+ from https://nodejs.org"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 16 ]; then
        echo -e "${RED}❌ Node.js version must be 16 or higher${NC}"
        echo "Current version: $(node -v)"
        exit 1
    fi
    echo -e "${GREEN}✓ Node.js $(node -v)${NC}"
    
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ npm is not installed${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ npm $(npm -v)${NC}"
    
    if ! command -v git &> /dev/null; then
        echo -e "${RED}❌ Git is not installed${NC}"
        echo "Please install Git from https://git-scm.com"
        exit 1
    fi
    echo -e "${GREEN}✓ Git $(git --version | cut -d' ' -f3)${NC}"
    
    echo ""
}

# Get plugin info from user
get_plugin_info() {
    echo "Enter plugin details:"
    echo ""
    
    read -p "Plugin ID (lowercase-with-hyphens): " PLUGIN_ID
    if [[ ! "$PLUGIN_ID" =~ ^[a-z][a-z0-9-]*$ ]]; then
        echo -e "${RED}Invalid ID. Use lowercase letters, numbers, and hyphens only.${NC}"
        exit 1
    fi
    if [[ "$PLUGIN_ID" == *"obsidian"* ]]; then
        echo -e "${RED}Plugin ID cannot contain 'obsidian'.${NC}"
        exit 1
    fi
    
    read -p "Plugin Name (Display Name): " PLUGIN_NAME
    read -p "Description (max 250 chars): " PLUGIN_DESC
    read -p "Author Name: " AUTHOR_NAME
    read -p "Author URL (optional): " AUTHOR_URL
    
    echo ""
}

# Clone and setup
setup_plugin() {
    PLUGIN_DIR="$PLUGIN_ID"
    
    echo "Setting up plugin in ./$PLUGIN_DIR..."
    
    if [ -d "$PLUGIN_DIR" ]; then
        echo -e "${YELLOW}Directory $PLUGIN_DIR already exists${NC}"
        read -p "Remove and recreate? (y/n): " CONFIRM
        if [ "$CONFIRM" = "y" ]; then
            rm -rf "$PLUGIN_DIR"
        else
            echo "Aborting."
            exit 1
        fi
    fi
    
    # Clone sample plugin
    echo "Cloning sample plugin template..."
    git clone --depth 1 https://github.com/obsidianmd/obsidian-sample-plugin.git "$PLUGIN_DIR"
    cd "$PLUGIN_DIR"
    
    # Remove git history and initialize fresh
    rm -rf .git
    git init
    
    # Update manifest.json
    echo "Updating manifest.json..."
    cat > manifest.json << EOF
{
	"id": "$PLUGIN_ID",
	"name": "$PLUGIN_NAME",
	"version": "0.0.1",
	"minAppVersion": "1.0.0",
	"description": "$PLUGIN_DESC",
	"author": "$AUTHOR_NAME",
	"authorUrl": "$AUTHOR_URL",
	"isDesktopOnly": false
}
EOF

    # Update package.json name
    sed -i.bak "s/\"name\": \"obsidian-sample-plugin\"/\"name\": \"$PLUGIN_ID\"/" package.json
    rm -f package.json.bak
    
    # Install dependencies
    echo "Installing dependencies..."
    npm install
    
    # Initial build
    echo "Running initial build..."
    npm run build
    
    # Create initial commit
    git add .
    git commit -m "Initial plugin setup"
    
    cd ..
    echo ""
    echo -e "${GREEN}✅ Plugin setup complete!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. cd $PLUGIN_DIR"
    echo "  2. npm run dev      # Start development"
    echo "  3. Edit main.ts to add your plugin logic"
    echo ""
    echo "Testing:"
    echo "  Copy the plugin folder to your vault's .obsidian/plugins/ directory"
    echo "  Or create a symlink for development"
    echo ""
}

# Main
check_prerequisites
get_plugin_info
setup_plugin
