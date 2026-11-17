from app.reconstruction import classify,build_plan,score

def test_patient_specific_reconstruction_classifies_3d_anatomical():
    assert classify('3D_Brain_T2_SAG SPAIR',360)=='brain'
    assert classify('sT1W_3D_TFE',200)=='brain'
    assert classify('eeT1W_3D_TFE_SPAIR GD',231)=='brain'
    assert classify('DTI_6',264)=='diffusion'
    assert classify('Reg - DTI_low',264)=='diffusion'
    assert classify('faReg - FA COLOR',33)=='diffusion'
    assert classify('B_FFE_SAG CD',85)=='spine'
    assert classify('B_FFE_SAG DL',108)=='spine'
def test_high_resolution_brain_series_priority():
    brain={'description':'3D_Brain_T2_SAG SPAIR','count':360}
    t1={'description':'sT1W_3D_TFE','count':200}
    dti={'description':'DTI_6','count':264}
    assert score(brain)>score(t1)>score(dti)
