// Archivo de testing para la funcionalidad de descarga de claves
// Ejecutar en consola del navegador para probar

// Mock de datos de prueba
const mockKeysData = {
  username: 'testuser',
  masterKey: 'P5K8xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  privateKeys: {
    owner: '5J1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    active: '5J2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    posting: '5J3xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    memo: '5J4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
  publicKeys: {
    owner: 'STM8xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    active: 'STM8xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    posting:
      'STM8xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    memo: 'STM8xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
  keysetId: 'testuser_12345',
  timestamp: new Date().toISOString(),
}

// Test 1: Verificar que jsPDF está disponible
console.log('🧪 Test 1: Verificando jsPDF...')
if (typeof window !== 'undefined' && 'jspdf' in window) {
  console.log('✅ jsPDF está disponible')
} else {
  console.error('❌ jsPDF no está disponible')
}

// Test 2: Verificar que el modal existe
console.log('🧪 Test 2: Verificando modal...')
const modal = document.querySelector('#download-format-modal')
if (modal) {
  console.log('✅ Modal encontrado')
} else {
  console.error('❌ Modal no encontrado')
}

// Test 3: Verificar botones del modal
console.log('🧪 Test 3: Verificando botones del modal...')
const btnTxt = document.querySelector('#btn-download-txt')
const btnPdf = document.querySelector('#btn-download-pdf')
const btnCancel = document.querySelector('#btn-cancel-download')

if (btnTxt && btnPdf && btnCancel) {
  console.log('✅ Todos los botones encontrados')
} else {
  console.error('❌ Faltan botones del modal')
}

// Test 4: Verificar funciones globales
console.log('🧪 Test 4: Verificando funciones globales...')
if (window.closeDownloadModal && window.handleFormatSelection) {
  console.log('✅ Funciones globales disponibles')
} else {
  console.error('❌ Funciones globales no disponibles')
}

// Test 5: Simular apertura de modal
console.log('🧪 Test 5: Simulando apertura de modal...')
const downloadBtn = document.querySelector('#btn-download-keys')
if (downloadBtn) {
  console.log('✅ Botón de descarga encontrado')
  // Simular click (descomentar para probar)
  // downloadBtn.click()
} else {
  console.error('❌ Botón de descarga no encontrado')
}

// Test 6: Verificar detección de entorno
console.log('🧪 Test 6: Verificando detección de entorno...')
const isInSandbox = window !== window.parent
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
console.log(`📱 Es móvil: ${isMobile}`)
console.log(`🖼️ En sandbox: ${isInSandbox}`)

// Test 7: Verificar soporte de APIs
console.log('🧪 Test 7: Verificando soporte de APIs...')
const hasClipboard = navigator.clipboard !== undefined
const hasBlob = typeof Blob !== 'undefined'
const hasURL = typeof URL !== 'undefined'
console.log(`📋 Clipboard API: ${hasClipboard ? '✅' : '❌'}`)
console.log(`📄 Blob API: ${hasBlob ? '✅' : '❌'}`)
console.log(`🔗 URL API: ${hasURL ? '✅' : '❌'}`)

console.log('🎉 Testing completado!')

// Función de ayuda para probar descarga TXT
window.testTxtDownload = () => {
  console.log('🧪 Probando descarga TXT...')
  if (window.handleFormatSelection) {
    window.handleFormatSelection('txt')
  }
}

// Función de ayuda para probar descarga PDF
window.testPdfDownload = () => {
  console.log('🧪 Probando descarga PDF...')
  if (window.handleFormatSelection) {
    window.handleFormatSelection('pdf')
  }
}

console.log('💡 Funciones de testing disponibles:')
console.log('- window.testTxtDownload()')
console.log('- window.testPdfDownload()')
