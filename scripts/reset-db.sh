#!/bin/bash
# Script para reiniciar la base de datos completamente
# Elimina el archivo de base de datos y vuelve a ejecutar la inicialización

echo "🗑️  Eliminando base de datos existente (holahive.db)..."
rm -f holahive.db

echo "✨ Inicializando nueva base de datos..."
pnpm db:init

echo "✅ Base de datos reiniciada correctamente."
