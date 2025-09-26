import requests
import time
import sys
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, ElementNotInteractableException
from selenium.webdriver.chrome.service import Service

# Configurar encoding para Windows
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass

def interactuar_y_reportar(driver: WebDriver, by_locator: tuple, nombre_elemento: str, texto_a_escribir: str = None):
    try:
        print("[BUSQUEDA] Buscando '{}'".format(nombre_elemento))
        wait = WebDriverWait(driver, 10)
        elemento = wait.until(EC.presence_of_element_located(by_locator))
        
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", elemento)
        time.sleep(1)
        
        wait.until(EC.element_to_be_clickable(by_locator))

        if texto_a_escribir is not None:
            print("[ESCRIBIR] Escribiendo en '{}'".format(nombre_elemento))
            elemento.click()
            time.sleep(0.5)
            elemento.clear()
            time.sleep(0.5)
            elemento.send_keys(texto_a_escribir)
            print("[EXITO] Texto escrito")
                
        else:
            print("[CLIC] Haciendo clic en '{}'".format(nombre_elemento))
            elemento.click()
            print("[EXITO] Clic exitoso")

    except Exception as e:
        print("[FALLO] Error con '{}': {}".format(nombre_elemento, e))
        input("Por favor, realiza la acción manualmente y presiona Enter...")
        print("[CONTINUAR] Reanudando...")

def main():
    # Configuración principal
    ADSPOWER_PROFILE_ID = "k157vfpk"

    print("[INICIO] Abriendo AdsPower ID: {}".format(ADSPOWER_PROFILE_ID))
    try:
        response = requests.get("http://local.adspower.net:50325/api/v1/browser/start?user_id={}".format(ADSPOWER_PROFILE_ID))
        data = response.json()
        
        if data["code"] != 0:
            print("[ERROR] {}".format(data["msg"]))
            exit()
            
        print("[EXITO] Perfil abierto")
        selenium_data = data["data"]
        driver_path = selenium_data["webdriver"]
        selenium_url = selenium_data["ws"]["selenium"]
        
        # Conectar
        chrome_options = Options()
        debug_addr = selenium_url.replace("ws://", "").split("/")[0]
        chrome_options.add_experimental_option("debuggerAddress", debug_addr)
        
        service = Service(executable_path=driver_path)
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        print("[CONEXION] Conectado a AdsPower")
        print("[NAVEGACION] Yendo a Google...")
        driver.get("https://accounts.google.com/signup/v2/webcreateaccount?flowName=GlifWebSignIn&flowEntry=SignUp&hl=es-419")
        time.sleep(3)
        
        # Paso 1: Nombre
        print("\n=== PASO 1: NOMBRE ===")
        interactuar_y_reportar(driver, (By.NAME, "firstName"), "Nombre", "Carlos")
        time.sleep(2)
        
        # Verificar que se escribió
        elemento_nombre = driver.find_element(By.NAME, "firstName")
        if elemento_nombre.get_attribute('value') == "Carlos":
            print("[VERIFICACION] Nombre escrito correctamente")
        else:
            print("[ADVERTENCIA] El nombre no se escribió correctamente")
        
        # Paso 2: Apellido
        print("\n=== PASO 2: APELLIDO ===")
        interactuar_y_reportar(driver, (By.NAME, "lastName"), "Apellido", "Rodriguez")
        time.sleep(2)
        
        # Paso 3: Siguiente
        print("\n=== PASO 3: SIGUIENTE ===")
        interactuar_y_reportar(driver, (By.XPATH, "//span[text()='Siguiente']"), "Botón Siguiente")
        
        print("\n[FINAL] Proceso completado. Revisa el navegador.")
        input("Presiona Enter para cerrar...")
        
    except Exception as e:
        print("[ERROR] {}".format(e))

if __name__ == "__main__":
    main()