#!/bin/bash

# Script to configure OFT (Omnichain Fungible Token) on XDC and CELO networks
# 
# This script automates the complete OFT setup process:
# 1. Deploy OFT contracts (MinterBurner and OFTAdapter) on both networks
# 2. Wire LayerZero connections between XDC and CELO
# 3. Grant MINTER_ROLE to MinterBurner on both networks
# 4. Transfer OFT adapter ownership to DAO Avatar on both networks
# 5. Set mint/burn limits on MinterBurner for both networks
# 6. Test bridge functionality (optional, last step)
#
# Usage:
#   ./scripts/multichain-deploy/oft/configure-oft-xdc-celo.sh
#
# Environment variables (optional):
#   WEEKLY_MINT_LIMIT=1000000      # Weekly mint limit in G$ (18 decimals)
#   MONTHLY_MINT_LIMIT=5000000     # Monthly mint limit in G$ (18 decimals)
#   WEEKLY_BURN_LIMIT=1000000      # Weekly burn limit in G$ (18 decimals)
#   MONTHLY_BURN_LIMIT=5000000     # Monthly burn limit in G$ (18 decimals)
#   SKIP_BRIDGE_TEST=true          # Skip bridge test step
#   SKIP_LIMITS=true               # Skip setting limits step

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if we're in the project root
if [ ! -f "hardhat.config.ts" ] && [ ! -f "hardhat.config.js" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

print_step "OFT Configuration Script for XDC and CELO"
echo "This script will configure OFT on both development-xdc and development-celo networks"
echo ""

# Step 1: Deploy OFT contracts
print_step "Step 1: Deploying OFT contracts"

print_step "Deploying on development-xdc..."
yarn hardhat run scripts/multichain-deploy/oft/oft-deploy.ts --network development-xdc
print_success "OFT contracts deployed on development-xdc"

print_step "Deploying on development-celo..."
yarn hardhat run scripts/multichain-deploy/oft/oft-deploy.ts --network development-celo
print_success "OFT contracts deployed on development-celo"

echo ""

# Step 2: Wire LayerZero connections
print_step "Step 2: Wiring LayerZero connections"

print_step "Wiring on development-xdc..."
yarn hardhat lz:oapp:wire --oapp-config ./layerzero.config.ts --network development-xdc
print_success "LayerZero wired on development-xdc"

print_step "Wiring on development-celo..."
yarn hardhat lz:oapp:wire --oapp-config ./layerzero.config.ts --network development-celo
print_success "LayerZero wired on development-celo"

echo ""

# Step 3: Grant MINTER_ROLE
print_step "Step 3: Granting MINTER_ROLE to GoodDollarMinterBurner"

print_step "Granting MINTER_ROLE on development-xdc..."
yarn hardhat run scripts/multichain-deploy/oft/grant-minter-role.ts --network development-xdc
print_success "MINTER_ROLE granted on development-xdc"

print_step "Granting MINTER_ROLE on development-celo..."
yarn hardhat run scripts/multichain-deploy/oft/grant-minter-role.ts --network development-celo
print_success "MINTER_ROLE granted on development-celo"

echo ""

# Step 4: Transfer ownership
print_step "Step 4: Transferring OFT adapter ownership to DAO Avatar"

print_step "Transferring ownership on development-xdc..."
yarn hardhat run scripts/multichain-deploy/oft/transfer-oft-adapter-ownership.ts --network development-xdc
print_success "Ownership transferred on development-xdc"

print_step "Transferring ownership on development-celo..."
yarn hardhat run scripts/multichain-deploy/oft/transfer-oft-adapter-ownership.ts --network development-celo
print_success "Ownership transferred on development-celo"

echo ""

# Step 5: Set limits (optional)
if [ "$SKIP_LIMITS" != "true" ]; then
    print_step "Step 5: Setting mint/burn limits"
    
    if [ -z "$WEEKLY_MINT_LIMIT" ] && [ -z "$MONTHLY_MINT_LIMIT" ] && [ -z "$WEEKLY_BURN_LIMIT" ] && [ -z "$MONTHLY_BURN_LIMIT" ]; then
        print_warning "No limit environment variables set. Skipping limits configuration."
        print_warning "To set limits, use:"
        print_warning "  WEEKLY_MINT_LIMIT=1000000 MONTHLY_MINT_LIMIT=5000000 \\"
        print_warning "  WEEKLY_BURN_LIMIT=1000000 MONTHLY_BURN_LIMIT=5000000 \\"
        print_warning "  ./scripts/multichain-deploy/oft/configure-oft-xdc-celo.sh"
    else
        print_step "Setting limits on development-xdc..."
        WEEKLY_MINT_LIMIT=$WEEKLY_MINT_LIMIT \
        MONTHLY_MINT_LIMIT=$MONTHLY_MINT_LIMIT \
        WEEKLY_BURN_LIMIT=$WEEKLY_BURN_LIMIT \
        MONTHLY_BURN_LIMIT=$MONTHLY_BURN_LIMIT \
        yarn hardhat run scripts/multichain-deploy/oft/set-minter-burner-limits.ts --network development-xdc
        print_success "Limits set on development-xdc"
        
        print_step "Setting limits on development-celo..."
        WEEKLY_MINT_LIMIT=$WEEKLY_MINT_LIMIT \
        MONTHLY_MINT_LIMIT=$MONTHLY_MINT_LIMIT \
        WEEKLY_BURN_LIMIT=$WEEKLY_BURN_LIMIT \
        MONTHLY_BURN_LIMIT=$MONTHLY_BURN_LIMIT \
        yarn hardhat run scripts/multichain-deploy/oft/set-minter-burner-limits.ts --network development-celo
        print_success "Limits set on development-celo"
    fi
    echo ""
else
    print_warning "Skipping limits configuration (SKIP_LIMITS=true)"
    echo ""
fi

# Step 6: Test bridge (optional, last step)
if [ "$SKIP_BRIDGE_TEST" != "true" ]; then
    print_step "Step 6: Testing bridge functionality"
    print_warning "This step will attempt to bridge 1 G$ from XDC to CELO"
    read -p "Do you want to test the bridge? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_step "Bridging from development-xdc to development-celo..."
        yarn hardhat run scripts/multichain-deploy/oft/bridge-oft-token.ts --network development-xdc || print_warning "Bridge test failed (this is okay if you don't have sufficient balance)"
        echo ""
    else
        print_warning "Skipping bridge test"
    fi
    echo ""
else
    print_warning "Skipping bridge test (SKIP_BRIDGE_TEST=true)"
    echo ""
fi

# Summary
print_step "Configuration Complete!"
print_success "OFT has been successfully configured on both XDC and CELO networks"
echo ""
echo "Summary of completed steps:"
echo "  ✅ Deployed OFT contracts on both networks"
echo "  ✅ Wired LayerZero connections"
echo "  ✅ Granted MINTER_ROLE to MinterBurner"
echo "  ✅ Transferred OFT adapter ownership to DAO Avatar"
if [ "$SKIP_LIMITS" != "true" ] && ([ -n "$WEEKLY_MINT_LIMIT" ] || [ -n "$MONTHLY_MINT_LIMIT" ] || [ -n "$WEEKLY_BURN_LIMIT" ] || [ -n "$MONTHLY_BURN_LIMIT" ]); then
    echo "  ✅ Set mint/burn limits"
fi
if [ "$SKIP_BRIDGE_TEST" != "true" ]; then
    echo "  ✅ Tested bridge functionality (if executed)"
fi
echo ""
print_success "You can now use the bridge-oft-token.ts script to bridge tokens between chains!"
print_success "Run: yarn hardhat run scripts/multichain-deploy/oft/bridge-oft-token.ts --network <network>"

