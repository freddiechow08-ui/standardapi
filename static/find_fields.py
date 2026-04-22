import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
import time

opts = uc.ChromeOptions()
opts.add_argument("--window-size=1400,900")
driver = uc.Chrome(options=opts, use_subprocess=True)
driver.get("https://esearch.ipd.gov.hk/nis-pos-view/#/pt/quicksearch?lang=en")
time.sleep(8)

# Print all input fields on the page
inputs = driver.find_elements(By.TAG_NAME, "input")
for inp in inputs:
    print(f"id='{inp.get_attribute('id')}' name='{inp.get_attribute('name')}' placeholder='{inp.get_attribute('placeholder')}' type='{inp.get_attribute('type')}'")

input("Press Enter to close...")
driver.quit()